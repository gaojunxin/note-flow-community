//! Public local SQLite transactions. No transport, sync planner or account dependency.
pub mod search;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, path::Path, time::Duration};

#[derive(Debug)]
pub enum Error {
    Storage(rusqlite::Error),
    Encoding(serde_json::Error),
    SchemaIncompatible,
    InvalidChange,
    RevisionConflict,
    ProfileBusy,
}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error)
    }
}
impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::Encoding(error)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct EntityRef {
    pub entity_type: String,
    pub entity_uid: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    #[serde(flatten)]
    pub reference: EntityRef,
    pub revision: String,
    pub deleted: bool,
    /// Opaque public portable value, including binary media encoding.
    pub value: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    #[serde(flatten)]
    pub reference: EntityRef,
    pub revision: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mutation {
    pub entity: Entity,
    pub expected_revision: Option<String>,
    pub change: Value,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityPage {
    pub items: Vec<Entity>,
    pub has_more: bool,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePage {
    pub items: Vec<Value>,
    pub has_more: bool,
    pub next_sequence: i64,
}

pub struct LocalStore {
    connection: Connection,
}
fn valid(value: &str) -> bool {
    !value.trim().is_empty()
}
fn valid_ref(reference: &EntityRef) -> bool {
    valid(&reference.entity_type) && valid(&reference.entity_uid)
}
impl LocalStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, Error> {
        Self::from_connection(Connection::open(path)?)
    }
    pub fn from_connection(connection: Connection) -> Result<Self, Error> {
        connection.busy_timeout(Duration::from_secs(5))?;
        // Serialize schema inspection and creation across simultaneous first opens.
        connection.execute_batch("BEGIN IMMEDIATE")?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 1 {
            return Err(Error::SchemaIncompatible);
        }
        let table_count: i64 = connection.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )?;
        if version == 0 && table_count != 0 {
            return Err(Error::SchemaIncompatible);
        }
        if version == 1 {
            let marker = connection
                .query_row(
                    "SELECT value FROM community_metadata WHERE key='format'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional();
            if !matches!(marker, Ok(Some(ref value)) if value == "note-flow-community-local-v1") {
                return Err(Error::SchemaIncompatible);
            }
        }
        if version == 0 {
            connection.execute_batch("
              CREATE TABLE community_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              INSERT INTO community_metadata(key,value) VALUES('format','note-flow-community-local-v1');
              CREATE TABLE community_entities(profile_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_uid TEXT NOT NULL,revision TEXT NOT NULL,deleted INTEGER NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(profile_id,entity_type,entity_uid));
              CREATE TABLE community_changes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL,change_id TEXT NOT NULL,change_json TEXT NOT NULL,UNIQUE(profile_id,change_id));
              CREATE INDEX community_changes_by_profile ON community_changes(profile_id,sequence);
              PRAGMA user_version=1;")?;
        }
        connection.execute_batch("COMMIT")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        Ok(Self { connection })
    }
    pub fn get(&self, profile: &str, reference: &EntityRef) -> Result<Option<Entity>, Error> {
        if !valid(profile) || !valid_ref(reference) {
            return Err(Error::InvalidChange);
        }
        let row: Option<(String, bool, String)> = self.connection.query_row(
            "SELECT revision,deleted,value_json FROM community_entities WHERE profile_id=?1 AND entity_type=?2 AND entity_uid=?3",
            params![profile,reference.entity_type,reference.entity_uid], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
        row.map(|(revision, deleted, json)| {
            Ok(Entity {
                reference: reference.clone(),
                revision,
                deleted,
                value: serde_json::from_str(&json)?,
            })
        })
        .transpose()
    }
    /// Caller stages async work outside SQLite; all observations are rechecked under the write lock.
    pub fn commit(
        &mut self,
        profile: &str,
        observations: &[Observation],
        mutations: &[Mutation],
    ) -> Result<(), Error> {
        if !valid(profile) {
            return Err(Error::InvalidChange);
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // 写入前还要校验参与决策的完整观测集，不只核对即将修改的实体，避免并发改变关联依据。
        for observation in observations {
            if !valid_ref(&observation.reference) {
                return Err(Error::InvalidChange);
            }
            let revision: Option<String> = transaction.query_row("SELECT revision FROM community_entities WHERE profile_id=?1 AND entity_type=?2 AND entity_uid=?3",
                params![profile,observation.reference.entity_type,observation.reference.entity_uid], |row| row.get(0)).optional()?;
            if revision != observation.revision {
                return Err(Error::RevisionConflict);
            }
        }
        let mut entities = HashSet::new();
        let mut changes = HashSet::new();
        for mutation in mutations {
            let entity = &mutation.entity;
            let change = &mutation.change;
            let change_id = change
                .get("changeId")
                .and_then(Value::as_str)
                .filter(|id| valid(id))
                .ok_or(Error::InvalidChange)?;
            if !valid_ref(&entity.reference)
                || !valid(&entity.revision)
                || !entity.value.is_object()
                || !entities.insert(entity.reference.clone())
                || !changes.insert(change_id)
                || mutation.expected_revision.as_ref() == Some(&entity.revision)
                || change.get("profileId").and_then(Value::as_str) != Some(profile)
                || change.get("entityType").and_then(Value::as_str)
                    != Some(&entity.reference.entity_type)
                || change.get("entityUid").and_then(Value::as_str)
                    != Some(&entity.reference.entity_uid)
                || change.get("afterRevision").and_then(Value::as_str) != Some(&entity.revision)
                || change.get("beforeRevision").and_then(Value::as_str)
                    != mutation.expected_revision.as_deref()
                || change
                    .get("createdAt")
                    .and_then(Value::as_str)
                    .filter(|s| valid(s))
                    .is_none()
            {
                return Err(Error::InvalidChange);
            }
            let previous: Option<(String,bool)> = transaction.query_row("SELECT revision,deleted FROM community_entities WHERE profile_id=?1 AND entity_type=?2 AND entity_uid=?3",
                params![profile,entity.reference.entity_type,entity.reference.entity_uid], |row| Ok((row.get(0)?,row.get(1)?))).optional()?;
            if previous.as_ref().map(|value| &value.0) != mutation.expected_revision.as_ref() {
                return Err(Error::RevisionConflict);
            }
            if entity.deleted && previous.as_ref().is_none_or(|value| value.1) {
                return Err(Error::RevisionConflict);
            }
            let action = if entity.deleted {
                "delete"
            } else if previous.as_ref().is_none_or(|value| value.1) {
                "create"
            } else {
                "update"
            };
            if change.get("action").and_then(Value::as_str) != Some(action) {
                return Err(Error::InvalidChange);
            }
            transaction.execute("INSERT INTO community_entities(profile_id,entity_type,entity_uid,revision,deleted,value_json) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(profile_id,entity_type,entity_uid) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted,value_json=excluded.value_json",
                params![profile,entity.reference.entity_type,entity.reference.entity_uid,entity.revision,entity.deleted,serde_json::to_string(&entity.value)?])?;
            let mut snapshot = change.clone();
            snapshot["entity"] = entity.value.clone();
            transaction.execute(
                "INSERT INTO community_changes(profile_id,change_id,change_json) VALUES(?1,?2,?3)",
                params![profile, change_id, serde_json::to_string(&snapshot)?],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }
    pub fn list_entities(
        &self,
        profile: &str,
        entity_type: Option<&str>,
        after: Option<&EntityRef>,
        include_deleted: bool,
        limit: usize,
    ) -> Result<EntityPage, Error> {
        if !valid(profile) || limit == 0 || limit > 200 {
            return Err(Error::InvalidChange);
        }
        let mut statement = self.connection.prepare("SELECT entity_type,entity_uid,revision,deleted,value_json FROM community_entities WHERE profile_id=?1 AND (?2 IS NULL OR entity_type=?2) AND (?3=1 OR deleted=0) AND (entity_type>?4 OR (entity_type=?4 AND entity_uid>?5)) ORDER BY entity_type,entity_uid LIMIT ?6")?;
        let rows = statement.query_map(
            params![
                profile,
                entity_type,
                include_deleted,
                after.map(|value| value.entity_type.as_str()).unwrap_or(""),
                after.map(|value| value.entity_uid.as_str()).unwrap_or(""),
                (limit + 1) as i64
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )?;
        let mut items = Vec::new();
        for row in rows {
            let (entity_type, entity_uid, revision, deleted, json) = row?;
            items.push(Entity {
                reference: EntityRef {
                    entity_type,
                    entity_uid,
                },
                revision,
                deleted,
                value: serde_json::from_str(&json)?,
            });
        }
        let has_more = items.len() > limit;
        items.truncate(limit);
        Ok(EntityPage { items, has_more })
    }
    pub fn list_changes(
        &self,
        profile: &str,
        after: i64,
        limit: usize,
    ) -> Result<ChangePage, Error> {
        if !valid(profile) || after < 0 || limit == 0 || limit > 200 {
            return Err(Error::InvalidChange);
        }
        let mut statement = self.connection.prepare("SELECT sequence,change_json FROM community_changes WHERE profile_id=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3")?;
        let rows = statement.query_map(params![profile, after, (limit + 1) as i64], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut items = Vec::new();
        for row in rows {
            let (sequence, json) = row?;
            let mut value: Value = serde_json::from_str(&json)?;
            value["sequence"] = sequence.into();
            items.push(value);
        }
        let has_more = items.len() > limit;
        items.truncate(limit);
        let next_sequence = items
            .last()
            .and_then(|value| value["sequence"].as_i64())
            .unwrap_or(after);
        Ok(ChangePage {
            items,
            has_more,
            next_sequence,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub schema: String,
    pub version: u32,
    pub exported_at: String,
    pub profile_id: String,
    pub entities: Vec<Entity>,
    pub changes: Vec<Value>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRequest {
    pub profile_id: String,
    pub operation: String,
    pub args: Value,
}
impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::SchemaIncompatible => "SCHEMA_INCOMPATIBLE",
            Self::InvalidChange | Self::Encoding(_) => "INVALID_CHANGE",
            Self::RevisionConflict => "REVISION_CONFLICT",
            Self::Storage(_) => "STORAGE_ERROR",
            Self::ProfileBusy => "PROFILE_BUSY",
        }
    }
}
impl LocalStore {
    pub fn export_workspace(
        &mut self,
        profile: &str,
        exported_at: &str,
    ) -> Result<WorkspaceSnapshot, Error> {
        if !valid(profile) || !valid(exported_at) {
            return Err(Error::InvalidChange);
        }
        let tx = self.connection.transaction()?;
        let entities = {
            let mut statement = tx.prepare("SELECT entity_type,entity_uid,revision,deleted,value_json FROM community_entities WHERE profile_id=?1 ORDER BY entity_type,entity_uid")?;
            let rows = statement.query_map([profile], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?;
            let mut entities = Vec::new();
            for row in rows {
                let (entity_type, entity_uid, revision, deleted, json) = row?;
                entities.push(Entity {
                    reference: EntityRef {
                        entity_type,
                        entity_uid,
                    },
                    revision,
                    deleted,
                    value: serde_json::from_str(&json)?,
                });
            }
            entities
        };
        let changes = {
            let mut statement = tx.prepare("SELECT sequence,change_json FROM community_changes WHERE profile_id=?1 ORDER BY sequence")?;
            let rows = statement.query_map([profile], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            let mut changes = Vec::new();
            for row in rows {
                let (sequence, json) = row?;
                let mut change: Value = serde_json::from_str(&json)?;
                change["sequence"] = sequence.into();
                changes.push(change);
            }
            changes
        };
        tx.commit()?;
        Ok(WorkspaceSnapshot {
            schema: "note-flow-community-workspace".into(),
            version: 1,
            exported_at: exported_at.into(),
            profile_id: profile.into(),
            entities,
            changes,
        })
    }
    pub fn restore_workspace(
        &mut self,
        profile: &str,
        snapshot: WorkspaceSnapshot,
    ) -> Result<(), Error> {
        if !valid(profile)
            || snapshot.schema != "note-flow-community-workspace"
            || snapshot.version != 1
            || !valid(&snapshot.profile_id)
            || !valid(&snapshot.exported_at)
        {
            return Err(Error::InvalidChange);
        }
        let mut references = HashSet::new();
        for entity in &snapshot.entities {
            if !valid_ref(&entity.reference)
                || !valid(&entity.revision)
                || !entity.value.is_object()
                || !references.insert(entity.reference.clone())
            {
                return Err(Error::InvalidChange);
            }
        }
        let mut change_ids = HashSet::new();
        let mut previous_sequence = 0;
        for change in &snapshot.changes {
            let sequence = change["sequence"].as_i64().ok_or(Error::InvalidChange)?;
            let change_id = change["changeId"]
                .as_str()
                .filter(|id| valid(id))
                .ok_or(Error::InvalidChange)?;
            let reference = EntityRef {
                entity_type: change["entityType"]
                    .as_str()
                    .ok_or(Error::InvalidChange)?
                    .into(),
                entity_uid: change["entityUid"]
                    .as_str()
                    .ok_or(Error::InvalidChange)?
                    .into(),
            };
            if sequence <= previous_sequence
                || !change_ids.insert(change_id)
                || !references.contains(&reference)
                || change["profileId"].as_str() != Some(&snapshot.profile_id)
                || !matches!(
                    change["action"].as_str(),
                    Some("create" | "update" | "delete")
                )
                || change["afterRevision"]
                    .as_str()
                    .filter(|value| valid(value))
                    .is_none()
                || change["createdAt"]
                    .as_str()
                    .filter(|value| valid(value))
                    .is_none()
            {
                return Err(Error::InvalidChange);
            }
            previous_sequence = sequence;
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let entities: i64 = tx.query_row(
            "SELECT count(*) FROM community_entities WHERE profile_id=?1",
            [profile],
            |row| row.get(0),
        )?;
        let changes: i64 = tx.query_row(
            "SELECT count(*) FROM community_changes WHERE profile_id=?1",
            [profile],
            |row| row.get(0),
        )?;
        if entities > 0 || changes > 0 {
            return Err(Error::ProfileBusy);
        }
        for entity in snapshot.entities {
            tx.execute("INSERT INTO community_entities(profile_id,entity_type,entity_uid,revision,deleted,value_json) VALUES(?1,?2,?3,?4,?5,?6)",params![profile,entity.reference.entity_type,entity.reference.entity_uid,entity.revision,entity.deleted,serde_json::to_string(&entity.value)?])?;
        }
        for mut change in snapshot.changes {
            change["profileId"] = profile.into();
            change
                .as_object_mut()
                .ok_or(Error::InvalidChange)?
                .remove("sequence");
            tx.execute(
                "INSERT INTO community_changes(profile_id,change_id,change_json) VALUES(?1,?2,?3)",
                params![
                    profile,
                    change["changeId"].as_str().ok_or(Error::InvalidChange)?,
                    serde_json::to_string(&change)?
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    /// Platform bridges bind the database path themselves; requests cannot select paths or SQL.
    pub fn request(&mut self, request: LocalRequest) -> Result<Value, Error> {
        let profile = request.profile_id.as_str();
        let args = request.args;
        if !valid(profile) {
            return Err(Error::InvalidChange);
        }
        match request.operation.as_str() {
            "get" => {
                let reference: EntityRef = serde_json::from_value(args)?;
                Ok(serde_json::to_value(self.get(profile, &reference)?)?)
            }
            "commit" => {
                #[derive(Deserialize)]
                struct Commit {
                    observations: Vec<Observation>,
                    mutations: Vec<Mutation>,
                }
                let request: Commit = serde_json::from_value(args)?;
                self.commit(profile, &request.observations, &request.mutations)?;
                Ok(Value::Null)
            }
            "listEntities" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct Query {
                    entity_type: Option<String>,
                    after: Option<EntityRef>,
                    #[serde(default)]
                    include_deleted: bool,
                    limit: usize,
                }
                let query: Query = serde_json::from_value(args)?;
                Ok(serde_json::to_value(self.list_entities(
                    profile,
                    query.entity_type.as_deref(),
                    query.after.as_ref(),
                    query.include_deleted,
                    query.limit,
                )?)?)
            }
            "listChanges" => {
                #[derive(Deserialize)]
                struct Query {
                    after: i64,
                    limit: usize,
                }
                let query: Query = serde_json::from_value(args)?;
                Ok(serde_json::to_value(self.list_changes(
                    profile,
                    query.after,
                    query.limit,
                )?)?)
            }
            "export" => {
                let timestamp = args["exportedAt"].as_str().ok_or(Error::InvalidChange)?;
                Ok(serde_json::to_value(
                    self.export_workspace(profile, timestamp)?,
                )?)
            }
            "restore" => {
                self.restore_workspace(profile, serde_json::from_value(args)?)?;
                Ok(Value::Null)
            }
            _ => Err(Error::InvalidChange),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn store() -> LocalStore {
        LocalStore::from_connection(Connection::open_in_memory().unwrap()).unwrap()
    }
    fn reference(uid: &str) -> EntityRef {
        EntityRef {
            entity_type: "note".into(),
            entity_uid: uid.into(),
        }
    }
    fn mutation(
        uid: &str,
        expected: Option<&str>,
        revision: &str,
        change_id: &str,
        deleted: bool,
    ) -> Mutation {
        Mutation {
            entity: Entity {
                reference: reference(uid),
                revision: revision.into(),
                deleted,
                value: json!({"title":revision,"future":{"preserved":true}}),
            },
            expected_revision: expected.map(String::from),
            change: json!({"profileId":"a","entityType":"note","entityUid":uid,"changeId":change_id,"action":if deleted {"delete"} else if expected.is_some() {"update"} else {"create"},"beforeRevision":expected,"afterRevision":revision,"createdAt":"2026-10-08T00:00:00.000Z"}),
        }
    }
    #[test]
    fn entity_and_log_commit_together_with_immutable_snapshot() {
        let mut db = store();
        db.commit("a", &[], &[mutation("n", None, "r1", "c1", false)])
            .unwrap();
        db.commit("a", &[], &[mutation("n", Some("r1"), "r2", "c2", false)])
            .unwrap();
        assert_eq!(
            db.get("a", &reference("n")).unwrap().unwrap().revision,
            "r2"
        );
        let changes = db.list_changes("a", 0, 10).unwrap();
        assert_eq!(changes.items.len(), 2);
        assert_eq!(changes.items[0]["entity"]["title"], "r1");
        assert!(db.get("b", &reference("n")).unwrap().is_none());
        assert!(db.list_changes("b", 0, 10).unwrap().items.is_empty());
    }
    #[test]
    fn duplicate_log_constraint_rolls_back_all_entity_writes() {
        let mut db = store();
        db.commit("a", &[], &[mutation("n", None, "r1", "same", false)])
            .unwrap();
        assert!(db
            .commit(
                "a",
                &[],
                &[
                    mutation("new", None, "new", "new", false),
                    mutation("n", Some("r1"), "r2", "same", false)
                ]
            )
            .is_err());
        assert!(db.get("a", &reference("new")).unwrap().is_none());
        assert_eq!(
            db.get("a", &reference("n")).unwrap().unwrap().revision,
            "r1"
        );
        assert_eq!(db.list_changes("a", 0, 10).unwrap().items.len(), 1);
    }
    #[test]
    fn stale_read_or_write_revision_prevents_partial_commit() {
        let mut db = store();
        db.commit("a", &[], &[mutation("n", None, "r1", "c1", false)])
            .unwrap();
        let observation = Observation {
            reference: reference("n"),
            revision: Some("r1".into()),
        };
        db.commit("a", &[], &[mutation("n", Some("r1"), "r2", "c2", false)])
            .unwrap();
        assert!(matches!(
            db.commit(
                "a",
                &[observation],
                &[mutation("new", None, "r1", "c3", false)]
            ),
            Err(Error::RevisionConflict)
        ));
        assert!(matches!(
            db.commit("a", &[], &[mutation("n", Some("r1"), "r3", "c4", false)]),
            Err(Error::RevisionConflict)
        ));
        assert!(db.get("a", &reference("new")).unwrap().is_none());
    }
    #[test]
    fn tombstone_and_explicit_restore_preserve_revision_guards() {
        let mut db = store();
        db.commit("a", &[], &[mutation("n", None, "r1", "c1", false)])
            .unwrap();
        db.commit("a", &[], &[mutation("n", Some("r1"), "r2", "c2", true)])
            .unwrap();
        assert!(db.get("a", &reference("n")).unwrap().unwrap().deleted);
        assert!(db
            .list_entities("a", None, None, false, 10)
            .unwrap()
            .items
            .is_empty());
        assert_eq!(
            db.list_entities("a", None, None, true, 10)
                .unwrap()
                .items
                .len(),
            1
        );
        assert!(matches!(
            db.commit("a", &[], &[mutation("n", None, "r3", "c3", false)]),
            Err(Error::RevisionConflict)
        ));
        let mut restore = mutation("n", Some("r2"), "r3", "c3", false);
        restore.change["action"] = "create".into();
        db.commit("a", &[], &[restore]).unwrap();
        assert!(!db.get("a", &reference("n")).unwrap().unwrap().deleted);
    }
    #[test]
    fn pages_are_stable_and_forged_changes_are_rejected() {
        let mut db = store();
        for (uid, id) in [("a", "z"), ("b", "m"), ("c", "a")] {
            db.commit("a", &[], &[mutation(uid, None, "r1", id, false)])
                .unwrap();
        }
        let first = db.list_entities("a", Some("note"), None, false, 2).unwrap();
        assert!(first.has_more);
        let last = db
            .list_entities("a", Some("note"), Some(&first.items[1].reference), false, 2)
            .unwrap();
        assert_eq!(last.items[0].reference.entity_uid, "c");
        let page = db.list_changes("a", 0, 2).unwrap();
        assert!(page.has_more);
        assert_eq!(page.items[0]["changeId"], "z");
        assert_eq!(
            db.list_changes("a", page.next_sequence, 2).unwrap().items[0]["changeId"],
            "a"
        );
        let mut forged = mutation("fake", None, "r1", "fake", false);
        forged.change["profileId"] = "b".into();
        assert!(matches!(
            db.commit("a", &[], &[forged]),
            Err(Error::InvalidChange)
        ));
        assert!(db.get("a", &reference("fake")).unwrap().is_none());
    }
    #[test]
    fn reopen_keeps_data_and_future_schema_is_rejected() {
        let file = std::env::temp_dir().join(format!(
            "noteflow-local-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let mut db = LocalStore::open(&file).unwrap();
            db.commit("a", &[], &[mutation("n", None, "r1", "c1", false)])
                .unwrap();
        }
        {
            let db = LocalStore::open(&file).unwrap();
            assert_eq!(
                db.get("a", &reference("n")).unwrap().unwrap().revision,
                "r1"
            );
        }
        std::fs::remove_file(file).unwrap();
        let connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", 99).unwrap();
        assert!(matches!(
            LocalStore::from_connection(connection),
            Err(Error::SchemaIncompatible)
        ));
    }
    #[test]
    fn refuses_foreign_databases_before_initializing_schema() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE notes(uid TEXT); INSERT INTO notes VALUES('original');")
            .unwrap();
        assert!(matches!(
            LocalStore::from_connection(connection),
            Err(Error::SchemaIncompatible)
        ));
        let connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", 1).unwrap();
        assert!(matches!(
            LocalStore::from_connection(connection),
            Err(Error::SchemaIncompatible)
        ));
    }
}

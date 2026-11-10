//! Native workspace persistence. The JSON payload remains compatible with the
//! existing TypeScript mirror while indexed columns keep list reads bounded.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{error::Error, fmt};
use uuid::Uuid;

pub const WORKSPACE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS areas(uid TEXT PRIMARY KEY NOT NULL,archived INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,entity_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_local_areas_active ON areas(deleted,archived,sort_order);
CREATE TABLE IF NOT EXISTS projects(uid TEXT PRIMARY KEY NOT NULL,area_uid TEXT NOT NULL,status TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,entity_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_local_projects_area ON projects(area_uid,deleted,status,sort_order);
CREATE TABLE IF NOT EXISTS outbox(operation_id TEXT PRIMARY KEY NOT NULL,entity_uid TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,operation_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status,created_at);
"#;

#[derive(Debug)]
pub enum RepositoryError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    InvalidCursor,
    MissingRelation {
        entity: &'static str,
        uid: String,
    },
    NotFound {
        entity: &'static str,
        uid: String,
    },
    VersionConflict {
        entity: &'static str,
        uid: String,
        expected: i64,
        actual: i64,
    },
}

impl fmt::Display for RepositoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite error: {e}"),
            Self::Json(e) => write!(f, "json error: {e}"),
            Self::InvalidCursor => f.write_str("invalid pagination cursor"),
            Self::MissingRelation { entity, uid } => write!(f, "missing {entity} relation: {uid}"),
            Self::NotFound { entity, uid } => write!(f, "{entity} not found: {uid}"),
            Self::VersionConflict {
                entity,
                uid,
                expected,
                actual,
            } => write!(
                f,
                "{entity} {uid} version conflict: expected {expected}, actual {actual}"
            ),
        }
    }
}
impl Error for RepositoryError {}
impl From<rusqlite::Error> for RepositoryError {
    fn from(v: rusqlite::Error) -> Self {
        Self::Sqlite(v)
    }
}
impl From<serde_json::Error> for RepositoryError {
    fn from(v: serde_json::Error) -> Self {
        Self::Json(v)
    }
}
pub type Result<T> = std::result::Result<T, RepositoryError>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub uid: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub archived: bool,
    pub version: i64,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub sync_status: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub uid: String,
    pub area_uid: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub status: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default = "default_progress_mode")]
    pub progress_mode: String,
    #[serde(default)]
    pub manual_progress: Option<i64>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
    pub version: i64,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub sync_status: Option<String>,
}
fn default_progress_mode() -> String {
    "task".into()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

pub struct WorkspaceRepository<'a> {
    connection: &'a Connection,
}
impl<'a> WorkspaceRepository<'a> {
    pub fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }
    pub fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(WORKSPACE_SCHEMA)?;
        Ok(())
    }

    pub fn list_areas(&self, cursor: Option<&str>, limit: usize) -> Result<Page<Area>> {
        list_json(self.connection, "areas", None, cursor, limit)
    }
    pub fn list_projects(
        &self,
        area_uid: Option<&str>,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<Page<Project>> {
        list_json(self.connection, "projects", area_uid, cursor, limit)
    }
    /// Return the complete persisted entity contract in the same order as the
    /// legacy TypeScript repository. Unknown JSON fields must survive reads.
    pub fn list_areas_contract(&self, cursor: Option<&str>, limit: usize) -> Result<Page<Value>> {
        list_contract_json(self.connection, "areas", None, cursor, limit)
    }
    pub fn list_projects_contract(
        &self,
        area_uid: Option<&str>,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<Page<Value>> {
        list_contract_json(self.connection, "projects", area_uid, cursor, limit)
    }
    pub fn get_area(&self, uid: &str) -> Result<Option<Area>> {
        get_json(self.connection, "areas", uid)
    }
    pub fn get_project(&self, uid: &str) -> Result<Option<Project>> {
        get_json(self.connection, "projects", uid)
    }

    pub fn create_area(&self, value: Area) -> Result<Area> {
        self.write_area(value, "create", None)
    }
    pub fn update_area(&self, value: Area) -> Result<Area> {
        let v = value.version;
        self.write_area(value, "update", Some(v))
    }
    pub fn delete_area(&self, mut value: Area) -> Result<Area> {
        let v = value.version;
        value.deleted = true;
        self.write_area(value, "delete", Some(v))
    }
    fn write_area(&self, mut value: Area, action: &str, expected: Option<i64>) -> Result<Area> {
        let tx = self.connection.unchecked_transaction()?;
        check_version::<Area>(&tx, "areas", "area", &value.uid, expected)?;
        let base = expected.unwrap_or(0);
        if expected.is_some() {
            value.version += 1;
        }
        value.sync_status = Some("pending".into());
        let json = serde_json::to_string(&value)?;
        tx.execute("INSERT INTO areas(uid,archived,sort_order,deleted,updated_at,entity_json) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(uid) DO UPDATE SET archived=excluded.archived,sort_order=excluded.sort_order,deleted=excluded.deleted,updated_at=excluded.updated_at,entity_json=excluded.entity_json",params![value.uid,value.archived,value.sort_order,value.deleted,value.updated_at,json])?;
        enqueue(
            &tx,
            "area",
            &value.uid,
            action,
            base,
            if action == "delete" {
                None
            } else {
                Some(serde_json::to_value(&value)?)
            },
            &value.updated_at,
        )?;
        tx.commit()?;
        Ok(value)
    }
    pub fn create_project(&self, value: Project) -> Result<Project> {
        self.write_project(value, "create", None)
    }
    pub fn update_project(&self, value: Project) -> Result<Project> {
        let v = value.version;
        self.write_project(value, "update", Some(v))
    }
    pub fn delete_project(&self, mut value: Project) -> Result<Project> {
        let v = value.version;
        value.deleted = true;
        self.write_project(value, "delete", Some(v))
    }
    fn write_project(
        &self,
        mut value: Project,
        action: &str,
        expected: Option<i64>,
    ) -> Result<Project> {
        let tx = self.connection.unchecked_transaction()?;
        require_active(&tx, "areas", "area", &value.area_uid)?;
        check_version::<Project>(&tx, "projects", "project", &value.uid, expected)?;
        let base = expected.unwrap_or(0);
        if expected.is_some() {
            value.version += 1;
        }
        value.sync_status = Some("pending".into());
        let json = serde_json::to_string(&value)?;
        tx.execute("INSERT INTO projects(uid,area_uid,status,sort_order,deleted,updated_at,entity_json) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(uid) DO UPDATE SET area_uid=excluded.area_uid,status=excluded.status,sort_order=excluded.sort_order,deleted=excluded.deleted,updated_at=excluded.updated_at,entity_json=excluded.entity_json",params![value.uid,value.area_uid,value.status,value.sort_order,value.deleted,value.updated_at,json])?;
        enqueue(
            &tx,
            "project",
            &value.uid,
            action,
            base,
            if action == "delete" {
                None
            } else {
                Some(serde_json::to_value(&value)?)
            },
            &value.updated_at,
        )?;
        tx.commit()?;
        Ok(value)
    }
}

pub(crate) fn require_active(
    tx: &Transaction<'_>,
    table: &str,
    entity: &'static str,
    uid: &str,
) -> Result<()> {
    let found: Option<i64> = tx
        .query_row(
            &format!("SELECT 1 FROM {table} WHERE uid=?1 AND deleted=0"),
            [uid],
            |r| r.get(0),
        )
        .optional()?;
    if found.is_none() {
        return Err(RepositoryError::MissingRelation {
            entity,
            uid: uid.into(),
        });
    }
    Ok(())
}
pub(crate) fn check_version<T: DeserializeOwned>(
    tx: &Transaction<'_>,
    table: &str,
    entity: &'static str,
    uid: &str,
    expected: Option<i64>,
) -> Result<()>
where
    T: Versioned,
{
    let Some(expected) = expected else {
        if get_json::<T>(tx, table, uid)?.is_some() {
            return Err(RepositoryError::VersionConflict {
                entity,
                uid: uid.into(),
                expected: 0,
                actual: 0,
            });
        }
        return Ok(());
    };
    let current = get_json::<T>(tx, table, uid)?.ok_or_else(|| RepositoryError::NotFound {
        entity,
        uid: uid.into(),
    })?;
    if current.version() != expected {
        return Err(RepositoryError::VersionConflict {
            entity,
            uid: uid.into(),
            expected,
            actual: current.version(),
        });
    }
    Ok(())
}
pub trait Versioned {
    fn version(&self) -> i64;
}
impl Versioned for Area {
    fn version(&self) -> i64 {
        self.version
    }
}
impl Versioned for Project {
    fn version(&self) -> i64 {
        self.version
    }
}

pub(crate) fn enqueue(
    tx: &Transaction<'_>,
    entity_type: &str,
    uid: &str,
    action: &str,
    base_version: i64,
    payload: Option<Value>,
    created_at: &str,
) -> Result<()> {
    let operation_id = Uuid::new_v4().to_string();
    let operation = serde_json::json!({"operationId":operation_id,"entityType":entity_type,"entityUid":uid,"action":action,"baseVersion":base_version,"payload":payload,"status":"pending","createdAt":created_at,"attempts":0});
    tx.execute("INSERT INTO outbox(operation_id,entity_uid,status,created_at,operation_json) VALUES(?1,?2,'pending',?3,?4)",params![operation_id,uid,created_at,operation.to_string()])?;
    Ok(())
}
fn get_json<T: DeserializeOwned>(
    connection: &Connection,
    table: &str,
    uid: &str,
) -> Result<Option<T>> {
    let json: Option<String> = connection
        .query_row(
            &format!("SELECT entity_json FROM {table} WHERE uid=?1"),
            [uid],
            |r| r.get(0),
        )
        .optional()?;
    json.map(|v| serde_json::from_str(&v).map_err(Into::into))
        .transpose()
}
fn list_json<T: DeserializeOwned>(
    connection: &Connection,
    table: &str,
    scope: Option<&str>,
    cursor: Option<&str>,
    limit: usize,
) -> Result<Page<T>> {
    let limit = limit.clamp(1, 200);
    let (time, uid) = cursor
        .map(decode_cursor)
        .transpose()?
        .unwrap_or_else(|| ("\u{10ffff}".into(), "\u{10ffff}".into()));
    let sql = if scope.is_some() {
        format!("SELECT entity_json,updated_at,uid FROM {table} WHERE deleted=0 AND area_uid=?1 AND (COALESCE(updated_at,'')<?2 OR (COALESCE(updated_at,'')=?2 AND uid<?3)) ORDER BY updated_at DESC,uid DESC LIMIT ?4")
    } else {
        format!("SELECT entity_json,updated_at,uid FROM {table} WHERE deleted=0 AND (COALESCE(updated_at,'')<?1 OR (COALESCE(updated_at,'')=?1 AND uid<?2)) ORDER BY updated_at DESC,uid DESC LIMIT ?3")
    };
    let mut statement = connection.prepare(&sql)?;
    let mut rows = if let Some(scope) = scope {
        statement.query(params![scope, time, uid, (limit + 1) as i64])?
    } else {
        statement.query(params![time, uid, (limit + 1) as i64])?
    };
    let mut values = Vec::new();
    while let Some(row) = rows.next()? {
        values.push((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, String>(2)?,
        ));
    }
    let more = values.len() > limit;
    values.truncate(limit);
    let next_cursor = if more {
        values.last().map(|(_, t, u)| encode_cursor(t, u))
    } else {
        None
    };
    Ok(Page {
        items: values
            .into_iter()
            .map(|(j, _, _)| serde_json::from_str(&j))
            .collect::<std::result::Result<_, _>>()?,
        next_cursor,
    })
}
fn list_contract_json(
    connection: &Connection,
    table: &str,
    scope: Option<&str>,
    cursor: Option<&str>,
    limit: usize,
) -> Result<Page<Value>> {
    let limit = limit.clamp(1, 200);
    let offset = match cursor {
        None => 0,
        Some(value) => value
            .strip_prefix("offset:")
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or(RepositoryError::InvalidCursor)?,
    };
    let sql = if scope.is_some() {
        format!("SELECT entity_json FROM {table} WHERE deleted=0 AND area_uid=?1 ORDER BY sort_order ASC,updated_at DESC,uid ASC LIMIT ?2 OFFSET ?3")
    } else {
        format!("SELECT entity_json FROM {table} WHERE deleted=0 ORDER BY sort_order ASC,updated_at DESC,uid ASC LIMIT ?1 OFFSET ?2")
    };
    let mut statement = connection.prepare(&sql)?;
    let mut rows = if let Some(scope) = scope {
        statement.query(params![scope, (limit + 1) as i64, offset as i64])?
    } else {
        statement.query(params![(limit + 1) as i64, offset as i64])?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let json: String = row.get(0)?;
        items.push(serde_json::from_str(&json)?);
    }
    let more = items.len() > limit;
    items.truncate(limit);
    Ok(Page {
        next_cursor: more.then(|| format!("offset:{}", offset + items.len())),
        items,
    })
}
fn encode_cursor(time: &str, uid: &str) -> String {
    format!("{}:{}:{}", time.len(), time, uid)
}
fn decode_cursor(value: &str) -> Result<(String, String)> {
    let (n, rest) = value
        .split_once(':')
        .ok_or(RepositoryError::InvalidCursor)?;
    let n: usize = n.parse().map_err(|_| RepositoryError::InvalidCursor)?;
    if rest.len() <= n || rest.as_bytes().get(n) != Some(&b':') {
        return Err(RepositoryError::InvalidCursor);
    }
    Ok((rest[..n].into(), rest[n + 1..].into()))
}

#[cfg(test)]
mod contract_tests {
    use super::*;

    #[test]
    fn contract_lists_keep_json_fields_and_legacy_sort_order_across_pages() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(WORKSPACE_SCHEMA).unwrap();
        for (uid, sort, updated, extra) in [
            ("a", 1, "1", "alpha"),
            ("b", 0, "1", "beta"),
            ("c", 0, "2", "gamma"),
        ] {
            let json = serde_json::json!({"uid":uid,"name":uid,"customField":extra});
            db.execute(
                "INSERT INTO areas(uid,archived,sort_order,deleted,updated_at,entity_json) VALUES(?1,0,?2,0,?3,?4)",
                params![uid, sort, updated, json.to_string()],
            ).unwrap();
        }
        let repo = WorkspaceRepository::new(&db);
        let first = repo.list_areas_contract(None, 2).unwrap();
        assert_eq!(first.items[0]["uid"], "c");
        assert_eq!(first.items[0]["customField"], "gamma");
        assert_eq!(first.items[1]["uid"], "b");
        let second = repo
            .list_areas_contract(first.next_cursor.as_deref(), 2)
            .unwrap();
        assert_eq!(second.items[0]["uid"], "a");
        assert!(second.next_cursor.is_none());
    }

    #[test]
    fn project_contract_scope_matches_legacy_repository() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(WORKSPACE_SCHEMA).unwrap();
        for (uid, area) in [("p1", "a1"), ("p2", "a2")] {
            let json = serde_json::json!({"uid":uid,"areaUid":area,"name":uid,"extension":42});
            db.execute(
                "INSERT INTO projects(uid,area_uid,status,sort_order,deleted,updated_at,entity_json) VALUES(?1,?2,'active',0,0,'1',?3)",
                params![uid, area, json.to_string()],
            ).unwrap();
        }
        let page = WorkspaceRepository::new(&db)
            .list_projects_contract(Some("a1"), None, 10)
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0]["uid"], "p1");
        assert_eq!(page.items[0]["extension"], 42);
    }
}

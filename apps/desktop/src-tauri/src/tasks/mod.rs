//! Native task repository backed by the existing `tasks`/`outbox` schema.

use crate::workspace::{
    check_version, enqueue, require_active, Page, RepositoryError, Result, Versioned,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const TASKS_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS tasks(uid TEXT PRIMARY KEY NOT NULL,completed INTEGER NOT NULL DEFAULT 0,due_at TEXT,updated_at TEXT,deleted INTEGER NOT NULL DEFAULT 0,entity_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_local_tasks_state ON tasks(deleted,completed,due_at,updated_at DESC);
"#;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub uid: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub area_uid: Option<String>,
    #[serde(default)]
    pub project_uid: Option<String>,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub completed: bool,
    pub version: i64,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub abandoned_at: Option<String>,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub sync_status: Option<String>,
}
impl Versioned for Task {
    fn version(&self) -> i64 {
        self.version
    }
}

pub struct TasksRepository<'a> {
    connection: &'a Connection,
}
impl<'a> TasksRepository<'a> {
    pub fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }
    pub fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(TASKS_SCHEMA)?;
        Ok(())
    }
    pub fn list(&self, cursor: Option<&str>, limit: usize) -> Result<Page<Task>> {
        // Task ordering is stable and bounded; cursor is the last `updated_at|uid` pair.
        let limit = limit.clamp(1, 200);
        let (time, uid) = decode(cursor)?;
        let mut statement=self.connection.prepare("SELECT entity_json,COALESCE(updated_at,''),uid FROM tasks WHERE deleted=0 AND (COALESCE(updated_at,'')<?1 OR (COALESCE(updated_at,'')=?1 AND uid<?2)) ORDER BY updated_at DESC,uid DESC LIMIT ?3")?;
        let mut rows = statement.query(params![time, uid, (limit + 1) as i64])?;
        let mut values = Vec::new();
        while let Some(row) = rows.next()? {
            values.push((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ));
        }
        let more = values.len() > limit;
        values.truncate(limit);
        let next_cursor = if more {
            values
                .last()
                .map(|(_, t, u)| format!("{}:{}:{}", t.len(), t, u))
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
    /// Read contract used by the TypeScript task repository.  Keep the JSON
    /// payload intact: older/newer clients may have fields that the native
    /// write model does not know about yet.
    pub fn list_contract(&self, cursor: Option<&str>, limit: usize) -> Result<Page<Value>> {
        let limit = limit.clamp(1, 200);
        let offset = decode_offset(cursor)?;
        let mut statement = self.connection.prepare(
            "SELECT entity_json FROM tasks WHERE deleted=0 \
             ORDER BY completed ASC,due_at ASC,updated_at DESC,uid ASC LIMIT ?1 OFFSET ?2",
        )?;
        let items = statement
            .query_map(params![(limit + 1) as i64, offset as i64], |row| {
                row.get::<_, String>(0)
            })?
            .map(|value| {
                let value = value?;
                serde_json::from_str(&value).map_err(RepositoryError::from)
            })
            .collect::<Result<Vec<Value>>>()?;
        page_from_offset(items, offset, limit)
    }
    pub fn create(&self, value: Task) -> Result<Task> {
        self.write(value, "create", None)
    }
    pub fn update(&self, value: Task) -> Result<Task> {
        let v = value.version;
        self.write(value, "update", Some(v))
    }
    pub fn delete(&self, mut value: Task) -> Result<Task> {
        let v = value.version;
        value.deleted = true;
        self.write(value, "delete", Some(v))
    }
    fn write(&self, mut value: Task, action: &str, expected: Option<i64>) -> Result<Task> {
        let tx = self.connection.unchecked_transaction()?;
        if let Some(uid) = value.area_uid.as_deref() {
            require_active(&tx, "areas", "area", uid)?;
        }
        if let Some(uid) = value.project_uid.as_deref() {
            require_active(&tx, "projects", "project", uid)?;
            let project_area: String =
                tx.query_row("SELECT area_uid FROM projects WHERE uid=?1", [uid], |r| {
                    r.get(0)
                })?;
            if value.area_uid.as_deref() != Some(&project_area) {
                return Err(RepositoryError::MissingRelation {
                    entity: "project in area",
                    uid: uid.into(),
                });
            }
        }
        check_version::<Task>(&tx, "tasks", "task", &value.uid, expected)?;
        let base = expected.unwrap_or(0);
        if expected.is_some() {
            value.version += 1;
        }
        value.sync_status = Some("pending".into());
        let json = serde_json::to_string(&value)?;
        tx.execute("INSERT INTO tasks(uid,completed,due_at,updated_at,deleted,entity_json) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(uid) DO UPDATE SET completed=excluded.completed,due_at=excluded.due_at,updated_at=excluded.updated_at,deleted=excluded.deleted,entity_json=excluded.entity_json",params![value.uid,value.completed,value.due_at,value.updated_at,value.deleted,json])?;
        enqueue(
            &tx,
            "task",
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
fn decode_offset(cursor: Option<&str>) -> Result<usize> {
    match cursor {
        None => Ok(0),
        Some(value) => value
            .strip_prefix("offset:")
            .and_then(|value| value.parse().ok())
            .ok_or(RepositoryError::InvalidCursor),
    }
}
fn page_from_offset<T>(mut items: Vec<T>, offset: usize, limit: usize) -> Result<Page<T>> {
    let more = items.len() > limit;
    items.truncate(limit);
    Ok(Page {
        next_cursor: more.then(|| format!("offset:{}", offset + items.len())),
        items,
    })
}
fn decode(cursor: Option<&str>) -> Result<(String, String)> {
    let Some(value) = cursor else {
        return Ok(("\u{10ffff}".into(), "\u{10ffff}".into()));
    };
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
mod tests {
    use super::*;
    use crate::workspace::{Area, Project, WorkspaceRepository, WORKSPACE_SCHEMA};
    fn area(uid: &str) -> Area {
        Area {
            uid: uid.into(),
            name: uid.into(),
            kind: "custom".into(),
            color: None,
            icon: None,
            sort_order: 0,
            archived: false,
            version: 0,
            deleted: false,
            created_at: None,
            updated_at: "2026-09-16T00:00:00Z".into(),
            sync_status: None,
        }
    }
    fn project(uid: &str, area_uid: &str) -> Project {
        Project {
            uid: uid.into(),
            area_uid: area_uid.into(),
            name: uid.into(),
            description: None,
            status: "active".into(),
            start_date: None,
            target_date: None,
            completed_at: None,
            progress_mode: "task".into(),
            manual_progress: None,
            color: None,
            icon: None,
            sort_order: 0,
            version: 0,
            deleted: false,
            created_at: None,
            updated_at: "2026-09-16T00:00:01Z".into(),
            sync_status: None,
        }
    }
    fn task(uid: &str, area_uid: Option<&str>, project_uid: Option<&str>, updated: &str) -> Task {
        Task {
            uid: uid.into(),
            title: uid.into(),
            description: None,
            area_uid: area_uid.map(Into::into),
            project_uid: project_uid.map(Into::into),
            priority: 0,
            completed: false,
            version: 0,
            due_at: None,
            start_at: None,
            completed_at: None,
            abandoned_at: None,
            deleted: false,
            created_at: None,
            updated_at: updated.into(),
            sync_status: None,
        }
    }
    fn db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(WORKSPACE_SCHEMA).unwrap();
        db.execute_batch(TASKS_SCHEMA).unwrap();
        db
    }
    #[test]
    fn crud_outbox_and_optimistic_conflict() {
        let db = db();
        let repo = TasksRepository::new(&db);
        let saved = repo.create(task("t", None, None, "3")).unwrap();
        assert_eq!(saved.version, 0);
        let mut updated = saved.clone();
        updated.title = "new".into();
        let updated = repo.update(updated).unwrap();
        assert_eq!(updated.version, 1);
        assert!(matches!(
            repo.update(saved),
            Err(RepositoryError::VersionConflict { .. })
        ));
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM outbox WHERE entity_uid='t'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
    }
    #[test]
    fn cursor_pages_without_returning_full_table() {
        let db = db();
        let repo = TasksRepository::new(&db);
        for n in 0..5 {
            repo.create(task(&format!("t{n}"), None, None, &format!("{n}")))
                .unwrap();
        }
        let first = repo.list(None, 2).unwrap();
        assert_eq!(first.items.len(), 2);
        let second = repo.list(first.next_cursor.as_deref(), 2).unwrap();
        assert_eq!(second.items.len(), 2);
        assert!(first
            .items
            .iter()
            .all(|a| second.items.iter().all(|b| a.uid != b.uid)));
    }
    #[test]
    fn contract_list_preserves_unknown_fields_and_legacy_order() {
        let db = db();
        db.execute(
            "INSERT INTO tasks(uid,completed,due_at,updated_at,deleted,entity_json) VALUES(?1,?2,?3,?4,0,?5)",
            params!["later", 0, "2026-10-02", "2", r#"{"uid":"later","title":"L","pluginField":{"kept":true}}"#],
        ).unwrap();
        db.execute(
            "INSERT INTO tasks(uid,completed,due_at,updated_at,deleted,entity_json) VALUES(?1,?2,?3,?4,0,?5)",
            params!["first", 0, Option::<String>::None, "1", r#"{"uid":"first","title":"F","extra":[1,2]}"#],
        ).unwrap();
        db.execute(
            "INSERT INTO tasks(uid,completed,due_at,updated_at,deleted,entity_json) VALUES(?1,?2,?3,?4,0,?5)",
            params!["done", 1, Option::<String>::None, "3", r#"{"uid":"done","title":"D"}"#],
        ).unwrap();
        let repo = TasksRepository::new(&db);
        let first = repo.list_contract(None, 2).unwrap();
        assert_eq!(first.items[0]["uid"], "first");
        assert_eq!(first.items[0]["extra"], serde_json::json!([1, 2]));
        assert_eq!(first.items[1]["pluginField"]["kept"], true);
        let second = repo.list_contract(first.next_cursor.as_deref(), 2).unwrap();
        assert_eq!(second.items[0]["uid"], "done");
        assert!(second.next_cursor.is_none());
    }
    #[test]
    fn relation_failure_rolls_back_entity_and_outbox() {
        let db = db();
        let repo = TasksRepository::new(&db);
        assert!(matches!(
            repo.create(task("bad", Some("missing"), None, "1")),
            Err(RepositoryError::MissingRelation { .. })
        ));
        assert_eq!(
            db.query_row("SELECT count(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM outbox", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn outbox_failure_rolls_back_entity_write() {
        let db = db();
        db.execute_batch("CREATE TRIGGER reject_task_outbox BEFORE INSERT ON outbox WHEN json_extract(NEW.operation_json,'$.entityType')='task' BEGIN SELECT RAISE(ABORT,'forced outbox failure'); END;").unwrap();
        let repo = TasksRepository::new(&db);
        assert!(repo.create(task("rolled-back", None, None, "1")).is_err());
        assert_eq!(
            db.query_row("SELECT count(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn validates_cross_domain_project_area() {
        let db = db();
        let work = WorkspaceRepository::new(&db);
        work.create_area(area("a1")).unwrap();
        work.create_area(area("a2")).unwrap();
        work.create_project(project("p", "a1")).unwrap();
        let repo = TasksRepository::new(&db);
        assert!(matches!(
            repo.create(task("bad", Some("a2"), Some("p"), "1")),
            Err(RepositoryError::MissingRelation { .. })
        ));
        assert!(repo.create(task("ok", Some("a1"), Some("p"), "2")).is_ok());
    }
}

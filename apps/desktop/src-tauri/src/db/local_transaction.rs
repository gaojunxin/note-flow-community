//! A leased SQLite connection for legacy JS repositories. No pooled statements
//! participate in the transaction; dropping a lease rolls it back (including process exit).
use rusqlite::{
    params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

struct Lease {
    connection: Connection,
    path: String,
    client: String,
    touched: Instant,
}
#[derive(Default)]
pub struct LocalTransactions(Mutex<HashMap<String, Lease>>);
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    action: String,
    transaction_id: String,
    client_id: String,
    path: String,
    sql: Option<String>,
    #[serde(default)]
    values: Vec<Value>,
}

fn file_name(path: &str) -> Result<&str, String> {
    let name = path
        .strip_prefix("sqlite:note-flow-v2-")
        .ok_or("Unsupported local database")?;
    let owner = name
        .strip_suffix(".db")
        .ok_or("Unsupported local database")?;
    if owner.is_empty()
        || owner.len() > 128
        || !owner
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid local database owner".into());
    }
    Ok(&path[7..])
}
fn bindings(values: Vec<Value>) -> Result<Vec<SqlValue>, String> {
    values
        .into_iter()
        .map(|v| {
            Ok(match v {
                Value::Null => SqlValue::Null,
                Value::Bool(v) => SqlValue::Integer(i64::from(v)),
                Value::String(v) => SqlValue::Text(v),
                Value::Number(v) => {
                    if let Some(v) = v.as_i64() {
                        SqlValue::Integer(v)
                    } else {
                        SqlValue::Real(v.as_f64().ok_or("Invalid number")?)
                    }
                }
                _ => return Err("Unsupported SQL value".into()),
            })
        })
        .collect()
}
impl LocalTransactions {
    /// Official extensions run on the very same leased connection as legacy repositories.
    /// No connection can be opened or lease created through this entry point.
    pub fn with_lease<R>(
        &self,
        transaction_id: &str,
        client_id: &str,
        path: &str,
        action: impl FnOnce(&Connection) -> Result<R, String>,
    ) -> Result<R, String> {
        file_name(path)?;
        let mut leases = self
            .0
            .lock()
            .map_err(|_| "Transaction registry unavailable")?;
        let lease = leases
            .get_mut(transaction_id)
            .ok_or("Local transaction expired or missing")?;
        if lease.path != path || lease.client != client_id {
            return Err("Local transaction owner mismatch".into());
        }
        if lease.touched.elapsed() > Duration::from_secs(60) {
            return Err("Local transaction expired or missing".into());
        }
        lease.touched = Instant::now();
        action(&lease.connection)
    }
    pub fn dispatch(&self, root: &Path, request: Request) -> Result<Value, String> {
        let filename = file_name(&request.path)?;
        let mut leases = self
            .0
            .lock()
            .map_err(|_| "Transaction registry unavailable")?;
        // A new webview client can reclaim its predecessor's connection after a reload.
        leases.retain(|_, lease| {
            let discard = lease.touched.elapsed() > Duration::from_secs(60)
                || (request.action == "begin"
                    && lease.path == request.path
                    && lease.client != request.client_id);
            if discard {
                let _ = lease.connection.execute_batch("ROLLBACK");
            }
            !discard
        });
        if request.action == "begin" {
            if leases.contains_key(&request.transaction_id)
                || leases.values().any(|lease| lease.path == request.path)
            {
                return Err("Local transaction already active".into());
            }
            let connection = Connection::open(root.join(filename)).map_err(|e| e.to_string())?;
            connection
                .busy_timeout(Duration::from_secs(10))
                .map_err(|e| e.to_string())?;
            connection
                .execute_batch("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE")
                .map_err(|e| e.to_string())?;
            leases.insert(
                request.transaction_id,
                Lease {
                    connection,
                    path: request.path,
                    client: request.client_id,
                    touched: Instant::now(),
                },
            );
            return Ok(json!(true));
        }
        let lease = leases
            .get_mut(&request.transaction_id)
            .ok_or("Local transaction expired or missing")?;
        if lease.path != request.path || lease.client != request.client_id {
            return Err("Local transaction owner mismatch".into());
        }
        lease.touched = Instant::now();
        if request.action == "commit" || request.action == "rollback" {
            let result = lease
                .connection
                .execute_batch(if request.action == "commit" {
                    "COMMIT"
                } else {
                    "ROLLBACK"
                })
                .map_err(|e| e.to_string());
            if result.is_err() {
                let _ = lease.connection.execute_batch("ROLLBACK");
            }
            leases.remove(&request.transaction_id);
            return result.map(|_| json!(true));
        }
        let sql = request.sql.ok_or("Missing SQL")?;
        let values = bindings(request.values)?;
        let mut statement = lease.connection.prepare(&sql).map_err(|e| e.to_string())?;
        // Never allow JS statements to commit or escape their leased transaction.
        let keyword = sql
            .trim_start()
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_ascii_uppercase();
        if [
            "BEGIN",
            "COMMIT",
            "END",
            "ROLLBACK",
            "SAVEPOINT",
            "RELEASE",
            "ATTACH",
            "DETACH",
            "VACUUM",
        ]
        .contains(&keyword.as_str())
            || (keyword == "PRAGMA"
                && !(request.action == "select"
                    && sql
                        .trim()
                        .to_ascii_lowercase()
                        .starts_with("pragma table_info(")))
        {
            return Err("Transaction control is native-owned".into());
        }
        match request.action.as_str() {
            "execute" => {
                let affected = statement
                    .execute(params_from_iter(values))
                    .map_err(|e| e.to_string())?;
                Ok(
                    json!({"rowsAffected":affected,"lastInsertId":lease.connection.last_insert_rowid()}),
                )
            }
            "select" => {
                if !statement.readonly() {
                    return Err("Select must be read-only".into());
                }
                let names: Vec<String> = statement
                    .column_names()
                    .iter()
                    .map(|s| s.to_string())
                    .collect();
                let mut rows = statement
                    .query(params_from_iter(values))
                    .map_err(|e| e.to_string())?;
                let mut output = Vec::new();
                while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                    let mut value = serde_json::Map::new();
                    for (i, name) in names.iter().enumerate() {
                        let field = match row.get_ref(i).map_err(|e| e.to_string())? {
                            ValueRef::Null => Value::Null,
                            ValueRef::Integer(v) => json!(v),
                            ValueRef::Real(v) => json!(v),
                            ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                            ValueRef::Blob(v) => json!(v),
                        };
                        value.insert(name.clone(), field);
                    }
                    output.push(Value::Object(value));
                }
                Ok(Value::Array(output))
            }
            _ => Err("Unknown local transaction action".into()),
        }
    }
}
#[tauri::command]
pub async fn local_sql_transaction(
    app: tauri::AppHandle,
    request: Request,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.path().app_config_dir().map_err(|e| e.to_string())?;
        app.state::<LocalTransactions>().dispatch(&root, request)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extension_uses_only_the_existing_owned_connection_and_its_transaction() {
        let root = tempfile::tempdir().unwrap();
        let db = Connection::open(root.path().join("note-flow-v2-test.db")).unwrap();
        db.execute_batch("CREATE TABLE entity(value TEXT)").unwrap();
        let state = LocalTransactions::default();
        assert!(state
            .with_lease("missing", "webview", "sqlite:note-flow-v2-test.db", |_| Ok(
                ()
            ))
            .is_err());
        state
            .dispatch(root.path(), request("begin", "lease", None))
            .unwrap();
        assert!(state
            .with_lease(
                "lease",
                "other-client",
                "sqlite:note-flow-v2-test.db",
                |_| Ok(())
            )
            .is_err());
        assert!(state
            .with_lease("lease", "webview", "sqlite:note-flow-v2-other.db", |_| Ok(
                ()
            ))
            .is_err());
        state
            .with_lease(
                "lease",
                "webview",
                "sqlite:note-flow-v2-test.db",
                |connection| {
                    assert!(!connection.is_autocommit());
                    connection
                        .execute("INSERT INTO entity VALUES('synthetic')", [])
                        .map_err(|e| e.to_string())?;
                    Ok(())
                },
            )
            .unwrap();
        state
            .dispatch(root.path(), request("rollback", "lease", None))
            .unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM entity", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(state
            .with_lease(
                "lease",
                "webview",
                "sqlite:note-flow-v2-test.db",
                |_| Ok(())
            )
            .is_err());
    }
    fn request(action: &str, id: &str, sql: Option<&str>) -> Request {
        Request {
            action: action.into(),
            transaction_id: id.into(),
            client_id: "webview".into(),
            path: "sqlite:note-flow-v2-test.db".into(),
            sql: sql.map(String::from),
            values: vec![],
        }
    }
    #[test]
    fn rollback_discards_entity_and_outbox_and_commit_keeps_both() {
        let root = std::env::temp_dir().join(format!("nf-transaction-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db = Connection::open(root.join("note-flow-v2-test.db")).unwrap();
        db.execute_batch("CREATE TABLE entity(value TEXT);CREATE TABLE outbox(value TEXT)")
            .unwrap();
        let state = LocalTransactions::default();
        state.dispatch(&root, request("begin", "a", None)).unwrap();
        state
            .dispatch(
                &root,
                request("execute", "a", Some("INSERT INTO entity VALUES('edit')")),
            )
            .unwrap();
        assert!(state
            .dispatch(
                &root,
                request("execute", "a", Some("INSERT INTO missing VALUES('fail')"))
            )
            .is_err());
        state
            .dispatch(&root, request("rollback", "a", None))
            .unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM entity", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        state.dispatch(&root, request("begin", "b", None)).unwrap();
        for table in ["entity", "outbox"] {
            state
                .dispatch(
                    &root,
                    request(
                        "execute",
                        "b",
                        Some(&format!("INSERT INTO {table} VALUES('edit')")),
                    ),
                )
                .unwrap();
        }
        state.dispatch(&root, request("commit", "b", None)).unwrap();
        for table in ["entity", "outbox"] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
        }
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn lost_client_connection_rolls_back_before_new_client_begins() {
        let root = std::env::temp_dir().join(format!("nf-lease-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db = Connection::open(root.join("note-flow-v2-test.db")).unwrap();
        db.execute_batch("CREATE TABLE entity(value TEXT)").unwrap();
        let state = LocalTransactions::default();
        state.dispatch(&root, request("begin", "a", None)).unwrap();
        state
            .dispatch(
                &root,
                request(
                    "execute",
                    "a",
                    Some("INSERT INTO entity VALUES('uncommitted')"),
                ),
            )
            .unwrap();
        let mut begin = request("begin", "b", None);
        begin.client_id = "reloaded".into();
        state.dispatch(&root, begin).unwrap();
        let mut rollback = request("rollback", "b", None);
        rollback.client_id = "reloaded".into();
        state.dispatch(&root, rollback).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM entity", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }
}

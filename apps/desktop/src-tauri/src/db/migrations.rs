use super::{DbConnection, DbError, DbResult};

pub const LATEST_SCHEMA_VERSION: i64 = 5;
// Keep aligned with the SQL plugin host local_schema_version migration ceiling.
pub const LATEST_PC_LOCAL_SCHEMA_VERSION: i64 = 8;

struct Migration {
    version: i64,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
}];

const DOMAIN_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS notes(uid TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,search_text TEXT NOT NULL,entity_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_notes_native_page ON notes(deleted,status,updated_at DESC,uid DESC);
CREATE TABLE IF NOT EXISTS note_summaries(uid TEXT PRIMARY KEY NOT NULL,status TEXT,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,summary_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(operation_id TEXT PRIMARY KEY NOT NULL,entity_uid TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,operation_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status,created_at);
CREATE TABLE IF NOT EXISTS areas(uid TEXT PRIMARY KEY NOT NULL,archived INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,entity_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_local_areas_active ON areas(deleted,archived,sort_order);
CREATE TABLE IF NOT EXISTS projects(uid TEXT PRIMARY KEY NOT NULL,area_uid TEXT NOT NULL,status TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,entity_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_local_projects_area ON projects(area_uid,deleted,status,sort_order);
CREATE TABLE IF NOT EXISTS tasks(uid TEXT PRIMARY KEY NOT NULL,completed INTEGER NOT NULL DEFAULT 0,due_at TEXT,updated_at TEXT,deleted INTEGER NOT NULL DEFAULT 0,entity_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_local_tasks_state ON tasks(deleted,completed,due_at,updated_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(uid UNINDEXED,title,content,tokenize='trigram');
"#;

/// Applies forward-only migrations atomically and records each completed version.
pub fn run_migrations(connection: &mut dyn DbConnection) -> DbResult<i64> {
    // Read the plugin host marker before any native DDL. Both hosts share the
    // same database and must refuse a newer or damaged local format.
    if connection.query_i64("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='metadata'")? > 0 {
        let invalid = connection.query_i64(&format!(
            "SELECT count(*) FROM metadata WHERE key='local_schema_version' AND (typeof(value)!='text' OR value='' OR value GLOB '*[^0-9]*' OR (length(value)>1 AND substr(value,1,1)='0') OR CAST(value AS INTEGER)>{LATEST_PC_LOCAL_SCHEMA_VERSION})"
        ))?;
        if invalid > 0 {
            return Err(DbError::Backend("local database schema is newer than supported or its version marker is damaged".into()));
        }
    }
    if connection.query_i64("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_version'")? > 0 {
        let invalid = connection.query_i64(&format!("SELECT count(*) FROM schema_version WHERE typeof(version)!='integer' OR version<0 OR version>{LATEST_SCHEMA_VERSION}"))?;
        if invalid > 0 {
            return Err(DbError::Backend("native database schema is newer than supported or its version records are damaged".into()));
        }
    }
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version(\
         version INTEGER PRIMARY KEY NOT NULL,\
         applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\
         )",
    )?;
    let current = connection.query_i64("SELECT COALESCE(MAX(version), 0) FROM schema_version")?;
    if current > LATEST_SCHEMA_VERSION {
        return Err(DbError::Backend(format!(
            "database schema version {current} is newer than supported version {LATEST_SCHEMA_VERSION}"
        )));
    }
    for migration in MIGRATIONS
        .iter()
        .filter(|migration| migration.version > current)
    {
        connection.execute_batch("BEGIN IMMEDIATE")?;
        let result = connection.execute_batch(migration.sql).and_then(|_| {
            connection.execute_batch(&format!(
                "INSERT INTO schema_version(version) VALUES({})",
                migration.version
            ))
        });
        match result {
            Ok(()) => {
                if let Err(error) = connection.execute_batch("COMMIT") {
                    let _ = connection.execute_batch("ROLLBACK");
                    return Err(error);
                }
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                return Err(error);
            }
        }
    }
    let current = connection.query_i64("SELECT COALESCE(MAX(version), 0) FROM schema_version")?;
    if current < 2 {
        connection.execute_batch("BEGIN IMMEDIATE")?;
        let result = connection.execute_batch(DOMAIN_SCHEMA).and_then(|_| {
            if connection.query_i64("SELECT count(*) FROM pragma_table_info('notes') WHERE name='version'")? == 0 {
                connection.execute_batch("ALTER TABLE notes ADD COLUMN version INTEGER NOT NULL DEFAULT 1")?;
            }
            connection.execute_batch("UPDATE notes SET version=max(1,coalesce(CAST(json_extract(entity_json,'$.version') AS INTEGER),1)); INSERT INTO schema_version(version) VALUES(2)")
        });
        match result {
            Ok(()) => {
                if let Err(error) = connection.execute_batch("COMMIT") {
                    let _ = connection.execute_batch("ROLLBACK");
                    return Err(error);
                }
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                return Err(error);
            }
        }
    }
    let current = connection.query_i64("SELECT COALESCE(MAX(version), 0) FROM schema_version")?;
    if current < 3 {
        connection.execute_batch("BEGIN IMMEDIATE")?;
        let result = connection.execute_batch("CREATE TABLE IF NOT EXISTS knowledge_nodes(uid TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,entity_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT);CREATE TABLE IF NOT EXISTS knowledge_relations(uid TEXT PRIMARY KEY NOT NULL,from_uid TEXT NOT NULL,to_uid TEXT NOT NULL,relation_type TEXT NOT NULL,statement TEXT,entity_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT);CREATE INDEX IF NOT EXISTS idx_knowledge_relation_from ON knowledge_relations(from_uid,deleted);CREATE INDEX IF NOT EXISTS idx_knowledge_relation_to ON knowledge_relations(to_uid,deleted);INSERT INTO schema_version(version) VALUES(3)");
        match result {
            Ok(()) => {
                if let Err(error) = connection.execute_batch("COMMIT") {
                    let _ = connection.execute_batch("ROLLBACK");
                    return Err(error);
                }
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                return Err(error);
            }
        }
    }
    let current = connection.query_i64("SELECT COALESCE(MAX(version), 0) FROM schema_version")?;
    if current < 4 {
        connection.execute_batch("BEGIN IMMEDIATE")?;
        let result = connection.execute_batch("CREATE TABLE IF NOT EXISTS canvases(uid TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,area_uid TEXT,project_uid TEXT,scene_data TEXT NOT NULL,text_index TEXT NOT NULL DEFAULT '',source_format TEXT,source_path TEXT,status TEXT NOT NULL DEFAULT 'active',version INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,entity_json TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_canvases_active ON canvases(deleted,updated_at DESC);CREATE TABLE IF NOT EXISTS canvas_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,canvas_uid TEXT NOT NULL,version INTEGER NOT NULL,scene_data TEXT NOT NULL,scene_checksum TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(canvas_uid,version));CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_canvas ON canvas_snapshots(canvas_uid,version DESC);INSERT INTO schema_version(version) VALUES(4)");
        match result {
            Ok(()) => {
                if let Err(error) = connection.execute_batch("COMMIT") {
                    let _ = connection.execute_batch("ROLLBACK");
                    return Err(error);
                }
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                return Err(error);
            }
        }
    }
    let current = connection.query_i64("SELECT COALESCE(MAX(version), 0) FROM schema_version")?;
    if current < 5 {
        connection.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> DbResult<()> {
            let columns = [
                ("canvas_type", "ALTER TABLE canvases ADD COLUMN canvas_type TEXT NOT NULL DEFAULT 'excalidraw'"),
                ("data_format", "ALTER TABLE canvases ADD COLUMN data_format TEXT NOT NULL DEFAULT 'excalidraw-json'"),
                ("data_version", "ALTER TABLE canvases ADD COLUMN data_version INTEGER NOT NULL DEFAULT 1"),
                ("source_mode", "ALTER TABLE canvases ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'independent'"),
                ("source_note_uid", "ALTER TABLE canvases ADD COLUMN source_note_uid TEXT"),
                ("document_data", "ALTER TABLE canvases ADD COLUMN document_data TEXT"),
            ];
            for (name, sql) in columns {
                if connection.query_i64(&format!(
                    "SELECT count(*) FROM pragma_table_info('canvases') WHERE name='{name}'"
                ))? == 0
                {
                    connection.execute_batch(sql)?;
                }
            }
            connection.execute_batch("UPDATE canvases SET canvas_type=coalesce(nullif(canvas_type,''),'excalidraw'),data_format=coalesce(nullif(data_format,''),'excalidraw-json'),data_version=max(1,coalesce(data_version,1)),source_mode=coalesce(nullif(source_mode,''),'independent'),document_data=coalesce(document_data,scene_data); INSERT INTO schema_version(version) VALUES(5)")
        })();
        match result {
            Ok(()) => {
                if let Err(error) = connection.execute_batch("COMMIT") {
                    let _ = connection.execute_batch("ROLLBACK");
                    return Err(error);
                }
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                return Err(error);
            }
        }
    }
    connection.query_i64("SELECT COALESCE(MAX(version), 0) FROM schema_version")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::SqliteConnection;
    use std::path::Path;

    #[test]
    fn rejects_corrupt_native_records_even_when_maximum_is_supported() {
        for invalid in ["-1", "NULL", "'invalid'", "1.5", "6"] {
            let mut connection = SqliteConnection::open(Path::new(":memory:"), 100).unwrap();
            connection.execute_batch(&format!("CREATE TABLE schema_version(version); INSERT INTO schema_version VALUES(5),({invalid}); CREATE TABLE synthetic_data(body TEXT); INSERT INTO synthetic_data VALUES('Synthetic retained body')")).unwrap();
            assert!(run_migrations(&mut connection).is_err());
            assert_eq!(connection.query_i64("SELECT count(*) FROM sqlite_master WHERE name='metadata'").unwrap(), 0);
            assert_eq!(connection.query_i64("SELECT count(*) FROM synthetic_data WHERE body='Synthetic retained body'").unwrap(), 1);
        }
    }

    #[test]
    fn rejects_future_or_damaged_plugin_schema_before_native_ddl() {
        for marker in ["'9'", "''", "NULL", "'8.5'", "'-1'", "'08'", "'999999999999999999999999'"] {
            let mut connection = SqliteConnection::open(Path::new(":memory:"), 100).unwrap();
            connection.execute_batch(&format!("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); INSERT INTO metadata VALUES('local_schema_version',{marker}); CREATE TABLE synthetic_data(body TEXT); INSERT INTO synthetic_data VALUES('Synthetic retained body')")).unwrap();
            assert!(run_migrations(&mut connection).is_err());
            assert_eq!(connection.query_i64("SELECT count(*) FROM sqlite_master WHERE name='schema_version'").unwrap(), 0);
            assert_eq!(connection.query_i64("SELECT count(*) FROM synthetic_data WHERE body='Synthetic retained body'").unwrap(), 1);
        }
    }

    #[test]
    fn accepts_supported_plugin_schema_without_rewriting_its_marker() {
        for marker in ["0", "7", "8"] {
            let mut connection = SqliteConnection::open(Path::new(":memory:"), 100).unwrap();
            connection.execute_batch(&format!("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO metadata VALUES('local_schema_version','{marker}')")).unwrap();
            assert_eq!(run_migrations(&mut connection).unwrap(), LATEST_SCHEMA_VERSION);
            assert_eq!(connection.query_i64(&format!("SELECT count(*) FROM metadata WHERE key='local_schema_version' AND value='{marker}'")).unwrap(), 1);
        }
    }

    #[test]
    fn migrations_are_transactional_and_idempotent() {
        let mut connection = SqliteConnection::open(Path::new(":memory:"), 100).unwrap();
        assert_eq!(
            run_migrations(&mut connection).unwrap(),
            LATEST_SCHEMA_VERSION
        );
        assert_eq!(
            run_migrations(&mut connection).unwrap(),
            LATEST_SCHEMA_VERSION
        );
        assert_eq!(
            connection
                .query_i64("SELECT count(*) FROM schema_version")
                .unwrap(),
            5
        );
    }

    #[test]
    fn upgrades_existing_typescript_notes_schema_without_losing_rows() {
        let mut connection = SqliteConnection::open(Path::new(":memory:"), 100).unwrap();
        connection.execute_batch("CREATE TABLE notes(uid TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,search_text TEXT NOT NULL,entity_json TEXT NOT NULL); INSERT INTO notes VALUES('n1','title','body','active',0,'2026-01-01','title body','{\"uid\":\"n1\",\"version\":7}')").unwrap();
        run_migrations(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_i64("SELECT version FROM notes WHERE uid='n1'")
                .unwrap(),
            7
        );
        assert_eq!(
            connection
                .query_i64("SELECT count(*) FROM notes WHERE uid='n1'")
                .unwrap(),
            1
        );
    }

    #[test]
    fn failed_commit_rolls_back_schema_and_allows_same_connection_retry() {
        let mut connection = SqliteConnection::open(Path::new(":memory:"), 100).unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE synthetic_parents(id INTEGER PRIMARY KEY); CREATE TABLE synthetic_children(parent_id INTEGER REFERENCES synthetic_parents(id) DEFERRABLE INITIALLY DEFERRED); CREATE TABLE notes(uid TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,search_text TEXT NOT NULL,entity_json TEXT NOT NULL); INSERT INTO notes VALUES('synthetic-note','Synthetic title','Synthetic original body','active',0,'2026-10-15','Synthetic','{\"version\":7}'); CREATE TRIGGER synthetic_bad_commit AFTER UPDATE ON notes BEGIN INSERT INTO synthetic_children(parent_id) VALUES(999); END;").unwrap();
        assert!(run_migrations(&mut connection).is_err());
        assert!(connection.raw().is_autocommit());
        assert_eq!(
            connection
                .query_i64("SELECT MAX(version) FROM schema_version")
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_i64("SELECT count(*) FROM pragma_table_info('notes') WHERE name='version'")
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_i64("SELECT count(*) FROM synthetic_children")
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_i64("SELECT count(*) FROM notes WHERE content='Synthetic original body'")
                .unwrap(),
            1
        );
        connection
            .execute_batch("DROP TRIGGER synthetic_bad_commit")
            .unwrap();
        assert_eq!(
            run_migrations(&mut connection).unwrap(),
            LATEST_SCHEMA_VERSION
        );
        assert_eq!(
            connection
                .query_i64("SELECT version FROM notes WHERE uid='synthetic-note'")
                .unwrap(),
            7
        );
    }
    #[test]
    fn rejects_a_future_schema_without_touching_existing_data() {
        let mut connection = SqliteConnection::open(Path::new(":memory:"), 100).unwrap();
        connection.execute_batch("CREATE TABLE schema_version(version INTEGER PRIMARY KEY NOT NULL);INSERT INTO schema_version VALUES(6);CREATE TABLE notes(content TEXT);INSERT INTO notes VALUES('Synthetic future body')").unwrap();
        assert!(run_migrations(&mut connection).is_err());
        assert!(connection.raw().is_autocommit());
        assert_eq!(
            connection
                .query_i64("SELECT MAX(version) FROM schema_version")
                .unwrap(),
            6
        );
        assert_eq!(
            connection
                .query_i64("SELECT count(*) FROM notes WHERE content='Synthetic future body'")
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_i64("SELECT count(*) FROM sqlite_master WHERE name='metadata'")
                .unwrap(),
            0
        );
    }
    #[test]
    fn upgrades_legacy_canvases_to_multiformat_documents() {
        let mut connection = SqliteConnection::open(Path::new(":memory:"), 100).unwrap();
        connection.execute_batch("CREATE TABLE schema_version(version INTEGER PRIMARY KEY NOT NULL,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);INSERT INTO schema_version(version) VALUES(4);CREATE TABLE canvases(uid TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,area_uid TEXT,project_uid TEXT,scene_data TEXT NOT NULL,text_index TEXT NOT NULL DEFAULT '',source_format TEXT,source_path TEXT,status TEXT NOT NULL DEFAULT 'active',version INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,entity_json TEXT NOT NULL);INSERT INTO canvases VALUES('c1','Legacy',NULL,NULL,'{\"type\":\"excalidraw\",\"elements\":[]}','',NULL,NULL,'active',1,0,'2026-01-01','2026-01-01','{}')").unwrap();
        assert_eq!(run_migrations(&mut connection).unwrap(), 5);
        assert_eq!(connection.query_i64("SELECT count(*) FROM canvases WHERE uid='c1' AND canvas_type='excalidraw' AND data_format='excalidraw-json' AND data_version=1 AND source_mode='independent' AND document_data=scene_data").unwrap(), 1);
    }
}

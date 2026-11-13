use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OpenFlags};

use super::{run_migrations, DbConnection, DbError, DbResult, ProfileId};

/// Direct SQLite connection owned exclusively by a profile's database actor.
pub struct SqliteConnection {
    connection: Connection,
}

impl SqliteConnection {
    pub fn open(path: &Path, busy_timeout_ms: u32) -> DbResult<Self> {
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(DbError::sqlite)?;
        connection
            .busy_timeout(Duration::from_millis(busy_timeout_ms.into()))
            .map_err(DbError::sqlite)?;
        Ok(Self { connection })
    }

    /// 仅在交给actor之前准备旧位置档案，运行期间仍由actor独占连接。
    pub(crate) fn raw_mut(&mut self) -> &mut Connection { &mut self.connection }

    pub fn raw(&self) -> &Connection {
        &self.connection
    }
}

impl DbConnection for SqliteConnection {
    fn execute_batch(&mut self, sql: &str) -> DbResult<()> {
        self.connection.execute_batch(sql).map_err(DbError::sqlite)
    }

    fn query_i64(&mut self, sql: &str) -> DbResult<i64> {
        self.connection
            .query_row(sql, [], |row| row.get(0))
            .map_err(DbError::sqlite)
    }

    fn sqlite(&mut self) -> DbResult<&mut Connection> {
        Ok(&mut self.connection)
    }
}

/// Returns the only supported database location for a profile.
pub fn profile_database_path(root: &Path, profile: &ProfileId) -> DbResult<PathBuf> {
    fs::create_dir_all(root).map_err(|error| {
        DbError::Backend(format!("failed to create app data directory: {error}"))
    })?;
    Ok(root.join(format!("note-flow-v2-{}.db", profile.as_str())))
}

/// Opens and migrates a profile database before it is handed to its actor.
pub fn open_profile_database(
    root: &Path,
    profile: &ProfileId,
    busy_timeout_ms: u32,
) -> DbResult<SqliteConnection> {
    let path = profile_database_path(root, profile)?;
    let mut connection = SqliteConnection::open(&path, busy_timeout_ms)?;
    run_migrations(&mut connection)?;
    Ok(connection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{DbActor, DbActorConfig};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("note-flow-{name}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn failed_profile_migration_preserves_file_and_can_reopen_after_synthetic_repair() {
        let directory = tempfile::tempdir().unwrap();
        let profile = ProfileId::new("synthetic_migration").unwrap();
        let path = profile_database_path(directory.path(), &profile).unwrap();
        {
            let mut original = SqliteConnection::open(&path, 100).unwrap();
            original.execute_batch("CREATE TABLE notes(uid TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,search_text TEXT NOT NULL,entity_json TEXT NOT NULL);INSERT INTO notes VALUES('synthetic-note','Synthetic title','Synthetic retained body','active',0,'2026-10-15','Synthetic','Synthetic invalid JSON')").unwrap();
        }
        assert!(open_profile_database(directory.path(), &profile, 100).is_err());
        assert!(open_profile_database(directory.path(), &profile, 100).is_err());
        {
            let mut original = SqliteConnection::open(&path, 100).unwrap();
            assert!(original.raw().is_autocommit());
            assert_eq!(original.query_i64("SELECT count(*) FROM notes WHERE content='Synthetic retained body' AND entity_json='Synthetic invalid JSON'").unwrap(), 1);
            assert_eq!(
                original
                    .query_i64("SELECT MAX(version) FROM schema_version")
                    .unwrap(),
                1
            );
            assert_eq!(
                original
                    .query_i64(
                        "SELECT count(*) FROM pragma_table_info('notes') WHERE name='version'"
                    )
                    .unwrap(),
                0
            );
            original
                .execute_batch(
                    "UPDATE notes SET entity_json='{\"version\":7}' WHERE uid='synthetic-note'",
                )
                .unwrap();
        }
        let mut upgraded = open_profile_database(directory.path(), &profile, 100).unwrap();
        assert_eq!(
            upgraded
                .query_i64("SELECT MAX(version) FROM schema_version")
                .unwrap(),
            crate::db::LATEST_SCHEMA_VERSION
        );
        assert_eq!(upgraded.query_i64("SELECT count(*) FROM notes WHERE content='Synthetic retained body' AND version=7").unwrap(), 1);
    }
    #[test]
    fn profile_path_is_scoped_below_root() {
        let root = temporary_root("path");
        let profile = ProfileId::new("account_42").unwrap();
        let path = profile_database_path(&root, &profile).unwrap();
        assert_eq!(path, root.join("note-flow-v2-account_42.db"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn real_connection_enables_wal_foreign_keys_and_rollback() {
        let root = temporary_root("sqlite");
        let profile = ProfileId::new("primary").unwrap();
        let mut connection = open_profile_database(&root, &profile, 250).unwrap();
        connection
            .execute_batch("PRAGMA journal_mode = WAL")
            .unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .unwrap();
        assert_eq!(
            connection
                .raw()
                .query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
        assert_eq!(
            connection
                .raw()
                .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );

        connection.execute_batch("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id))").unwrap();
        assert!(connection
            .execute_batch("INSERT INTO child(parent_id) VALUES(99)")
            .is_err());
        connection
            .execute_batch("BEGIN IMMEDIATE; INSERT INTO parent(id) VALUES(1); ROLLBACK")
            .unwrap();
        assert_eq!(
            connection.query_i64("SELECT count(*) FROM parent").unwrap(),
            0
        );
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn actor_rolls_back_a_real_sqlite_transaction() {
        let root = temporary_root("actor-rollback");
        let profile = ProfileId::new("primary").unwrap();
        let connection = open_profile_database(&root, &profile, 250).unwrap();
        let actor = DbActor::spawn(
            profile,
            Box::new(connection),
            DbActorConfig {
                busy_timeout_ms: 250,
            },
        )
        .unwrap();
        actor
            .run(|db| db.execute_batch("CREATE TABLE values_for_test(value INTEGER NOT NULL)"))
            .unwrap();
        let failed: DbResult<()> = actor.transaction(|db| {
            db.execute_batch("INSERT INTO values_for_test(value) VALUES(7)")?;
            Err(DbError::Backend("force rollback".into()))
        });
        assert!(failed.is_err());
        assert_eq!(
            actor
                .run(|db| db.query_i64("SELECT count(*) FROM values_for_test"))
                .unwrap(),
            0
        );
        actor.shutdown().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}

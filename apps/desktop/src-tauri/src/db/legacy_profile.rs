//! 保全旧AppCore数据目录数据库；配置目录是SQL插件与AppCore共同的权威位置，旧表仅作为惰性档案。
use super::{DbError, DbResult, ProfileId};
use base64::Engine;
use rusqlite::{types::ValueRef, Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
const MARKER: &str = "appcore_data_root_retired_v1";
fn error(message: impl Into<String>) -> DbError {
    DbError::Backend(message.into())
}
/// 旧库以只读连接和一致快照读取；档案与退役标记同目标事务提交，失败不改源、不自动合并。
pub fn preserve(
    target: &mut Connection,
    data_root: &Path,
    database_root: &Path,
    profile: &ProfileId,
) -> DbResult<()> {
    if data_root == database_root {
        return Ok(());
    }
    target.execute_batch("CREATE TABLE IF NOT EXISTS profile_legacy_archives(uid TEXT PRIMARY KEY,source TEXT NOT NULL,archive_json TEXT NOT NULL)").map_err(DbError::sqlite)?;
    let done: Option<String> = target
        .query_row("SELECT value FROM metadata WHERE key=?1", [MARKER], |r| {
            r.get(0)
        })
        .optional()
        .map_err(DbError::sqlite)?;
    if done.is_some() {
        return Ok(());
    }
    let name = format!("note-flow-v2-{}.db", profile.as_str());
    let source = data_root.join(&name);
    let destination = database_root.join(&name);
    let exists = match std::fs::symlink_metadata(&source) {
        Ok(m) => {
            if !m.is_file() || m.file_type().is_symlink() {
                return Err(error("旧AppCore数据库不是普通文件，原材料已保留"));
            }
            true
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(error(e.to_string())),
    };
    let same = exists
        && source.canonicalize().map_err(|e| error(e.to_string()))?
            == destination
                .canonicalize()
                .map_err(|e| error(e.to_string()))?;
    let snapshot = if exists && !same {
        Some(capture(&source)?)
    } else {
        None
    };
    let tx = target
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(DbError::sqlite)?;
    // 再次核对，避免两个窗口首次准备时重复提交；未引用的旧源仍保留，绝不重放其中的操作。
    let done: Option<String> = tx
        .query_row("SELECT value FROM metadata WHERE key=?1", [MARKER], |r| {
            r.get(0)
        })
        .optional()
        .map_err(DbError::sqlite)?;
    if done.is_none() {
        if let Some(value) = snapshot {
            let uid = format!("{:x}", Sha256::digest(value.as_bytes()));
            tx.execute("INSERT OR IGNORE INTO profile_legacy_archives(uid,source,archive_json) VALUES(?1,?2,?3)",rusqlite::params![uid,name,value]).map_err(DbError::sqlite)?;
        }
        tx.execute("INSERT INTO metadata VALUES(?1,'retired')", [MARKER])
            .map_err(DbError::sqlite)?;
    }
    tx.commit().map_err(DbError::sqlite)
}
fn quoted(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
fn capture(path: &Path) -> DbResult<String> {
    let mut source = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(DbError::sqlite)?;
    source
        .busy_timeout(std::time::Duration::from_secs(10))
        .map_err(DbError::sqlite)?;
    let tx = source.transaction().map_err(DbError::sqlite)?;
    let definitions = {
        let mut q=tx.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'note_search%' ORDER BY name").map_err(DbError::sqlite)?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(DbError::sqlite)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(DbError::sqlite)?
    };
    let mut tables = Vec::new();
    let mut count = 0usize;
    let mut bytes = 0usize;
    for (name, sql) in definitions {
        let mut q = tx
            .prepare(&format!("SELECT * FROM {}", quoted(&name)))
            .map_err(DbError::sqlite)?;
        let columns = q
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        let mut cursor = q.query([]).map_err(DbError::sqlite)?;
        let mut rows = Vec::new();
        while let Some(row) = cursor.next().map_err(DbError::sqlite)? {
            count += 1;
            if count > 20000 {
                return Err(error("旧AppCore资料超过20000行保全上限，源库已保留"));
            }
            let mut values = Vec::new();
            for i in 0..columns.len() {
                values.push(match row.get_ref(i).map_err(DbError::sqlite)?{ValueRef::Null=>json!({"kind":"null"}),ValueRef::Integer(v)=>json!({"kind":"integer","value":v.to_string()}),ValueRef::Real(v)=>json!({"kind":"real","bits":format!("{:016x}",v.to_bits())}),ValueRef::Text(v)=>json!({"kind":"text","value":std::str::from_utf8(v).map_err(|_|error("旧库包含非UTF-8文本，原材料已保留"))?}),ValueRef::Blob(v)=>json!({"kind":"blob","base64":base64::engine::general_purpose::STANDARD.encode(v)})})
            }
            let row = Value::Array(values);
            let size = row.to_string().len();
            bytes += size;
            if size > 32 * 1024 * 1024 || bytes > 64 * 1024 * 1024 {
                return Err(error("旧AppCore资料超过保全字节上限，源库已保留"));
            }
            rows.push(row)
        }
        tables.push(json!({"name":name,"sql":sql,"columns":columns,"rows":rows}));
    }
    let value = json!({"schema":"note-flow-legacy-profile/1","tables":tables}).to_string();
    if value.len() > 64 * 1024 * 1024 {
        return Err(error("旧AppCore档案超过64MiB上限，源库已保留"));
    }
    tx.commit().map_err(DbError::sqlite)?;
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_old_file_types_and_does_not_replace_current_notes_or_reimport() {
        let d = tempfile::tempdir().unwrap();
        let data = d.path().join("data");
        let config = d.path().join("config");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        let profile = ProfileId::new("synthetic").unwrap();
        let old = data.join("note-flow-v2-synthetic.db");
        let legacy = Connection::open(&old).unwrap();
        legacy.execute_batch("CREATE TABLE notes(uid TEXT,content TEXT);INSERT INTO notes VALUES('same','Old body');CREATE TABLE evidence(i INTEGER,b BLOB,r REAL);INSERT INTO evidence VALUES(9223372036854775807,x'0080ff',1.25)").unwrap();
        let mut target = Connection::open(config.join("note-flow-v2-synthetic.db")).unwrap();
        target.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE notes(uid TEXT,content TEXT);INSERT INTO notes VALUES('same','Current body')").unwrap();
        preserve(&mut target, &data, &config, &profile).unwrap();
        assert_eq!(
            target
                .query_row("SELECT content FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Current body"
        );
        let raw: String = target
            .query_row(
                "SELECT archive_json FROM profile_legacy_archives",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            raw.contains("9223372036854775807") && raw.contains("AID/") && raw.contains("Old body")
        );
        legacy
            .execute("INSERT INTO notes VALUES('late','Unmerged old edit')", [])
            .unwrap();
        drop(target);
        let mut target = Connection::open(config.join("note-flow-v2-synthetic.db")).unwrap();
        preserve(&mut target, &data, &config, &profile).unwrap();
        assert_eq!(
            target
                .query_row("SELECT count(*) FROM profile_legacy_archives", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            legacy
                .query_row("SELECT count(*) FROM notes", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn failed_marker_rolls_back_archive_and_preserves_source() {
        let d = tempfile::tempdir().unwrap();
        let data = d.path().join("data");
        let config = d.path().join("config");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        let profile = ProfileId::new("synthetic").unwrap();
        Connection::open(data.join("note-flow-v2-synthetic.db"))
            .unwrap()
            .execute_batch("CREATE TABLE proof(body TEXT);INSERT INTO proof VALUES('Original')")
            .unwrap();
        let mut target = Connection::open(config.join("note-flow-v2-synthetic.db")).unwrap();
        target.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);CREATE TRIGGER synthetic_fail BEFORE INSERT ON metadata BEGIN SELECT RAISE(ABORT,'synthetic');END").unwrap();
        assert!(preserve(&mut target, &data, &config, &profile).is_err());
        assert_eq!(
            target
                .query_row("SELECT count(*) FROM profile_legacy_archives", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        target.execute_batch("DROP TRIGGER synthetic_fail").unwrap();
        preserve(&mut target, &data, &config, &profile).unwrap();
    }
}

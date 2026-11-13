//! 日志采集暂存：文件先校验发布，再以SQLite事务提交引用；失败允许留下未引用文件，不能发布半条记录。
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub action: String,
    pub scope: String,
    #[serde(default)]
    pub epoch: u64,
    pub value: Option<Value>,
    pub uid: Option<String>,
    #[serde(default)]
    pub rows: Vec<Value>,
}
fn init(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS capture_state(scope TEXT PRIMARY KEY,epoch INTEGER NOT NULL,ready INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS capture_rows(scope TEXT NOT NULL,kind TEXT NOT NULL,uid TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,kind,uid));").map_err(|e|e.to_string())
}
fn state(db: &Connection, scope: &str) -> Result<(u64, bool)> {
    db.query_row(
        "SELECT epoch,ready FROM capture_state WHERE scope=?1",
        [scope],
        |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
    )
    .optional()
    .map(|v| v.unwrap_or((0, false)))
    .map_err(|e| e.to_string())
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn value_hash(value: &Value) -> String {
    let mut canonical = value.clone();
    canonical.sort_all_objects();
    hash(canonical.to_string().as_bytes())
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
/// 根路径只由profile与scope摘要派生，不接受前端文件路径；文件无扩展名且按内容寻址。
pub fn root(base: &Path, profile: &str, scope: &str) -> PathBuf {
    base.join("capture-resources")
        .join(hash(profile.as_bytes()))
        .join(hash(scope.as_bytes()))
}
fn checked_file(root: &Path, sha: &str) -> Result<PathBuf> {
    if !digest(sha) {
        return Err("日志附件摘要无效".into());
    }
    let path = root.join(sha);
    let m = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !m.is_file() || m.file_type().is_symlink() {
        return Err("日志附件不是普通文件".into());
    }
    Ok(path)
}
pub fn read_file(root: &Path, sha: &str) -> Result<Vec<u8>> {
    read_resource_with_limit(root, sha, 64 * 1024 * 1024)
}
/// 其他本机领域可在自身契约限额内读取资源，最高256MiB；日志仍使用64MiB包装入口。
pub fn read_resource_with_limit(root: &Path, sha: &str, limit: u64) -> Result<Vec<u8>> {
    if limit > 256 * 1024 * 1024 {
        return Err("资源读取限额无效".into());
    }
    let path = checked_file(root, sha)?;
    let m = fs::metadata(&path).map_err(|e| e.to_string())?;
    if m.len() > limit {
        return Err("资源超过所属领域的读取上限".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if hash(&bytes) != sha {
        return Err("日志附件校验失败".into());
    }
    Ok(bytes)
}
fn validate(root: &Path, scope: &str, v: &Value) -> Result<()> {
    if v.to_string().len() > 32 * 1024 * 1024
        || v["schema"] != 1
        || v["scope"] != scope
        || !v["operationUid"]
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 128)
        || !v["input"].is_object()
        || !v["text"].is_string()
    {
        return Err("日志暂存元数据无效".into());
    }
    let input = &v["input"];
    let uid = |v: &Value| {
        v.as_str().is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 128
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
    };
    let allowed = [
        "uid",
        "title",
        "content",
        "type",
        "status",
        "organizationStatus",
        "captureSource",
        "projectUid",
        "areaUid",
        "periodKey",
    ];
    if !uid(&v["operationUid"])
        || !uid(&input["uid"])
        || input
            .as_object()
            .is_none_or(|o| o.keys().any(|k| !allowed.contains(&k.as_str())))
        || !input["title"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty())
        || v["text"].as_str().map(str::trim) != input["content"].as_str()
        || input["type"] != "work_log"
        || !input["captureSource"]
            .as_str()
            .is_some_and(|s| ["quick_log_work", "quick_log_diary"].contains(&s))
        || v.get("committed").is_some_and(|v| !v.is_boolean())
        || !v["createdAt"].is_string()
    {
        return Err("日志采集字段无效".into());
    }
    let files = v["files"].as_array().ok_or("日志附件列表无效")?;
    let mut ids = std::collections::HashSet::new();
    for f in files {
        let uid = f["uid"].as_str().ok_or("附件身份缺失")?;
        if !ids.insert(uid)
            || !f["name"].is_string()
            || !f["type"].is_string()
            || !f["lastModified"].is_number()
        {
            return Err("附件元数据无效".into());
        }
        let bytes = read_file(root, f["sha256"].as_str().ok_or("附件摘要缺失")?)?;
        if f["sizeBytes"].as_u64() != Some(bytes.len() as u64) || bytes.is_empty() {
            return Err("附件长度不一致".into());
        }
    }
    Ok(())
}
fn read(db: &Connection, scope: &str, kind: &str, uid: &str) -> Result<Option<Value>> {
    let raw: Option<String> = db
        .query_row(
            "SELECT value FROM capture_rows WHERE scope=?1 AND kind=?2 AND uid=?3",
            params![scope, kind, uid],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        .transpose()
}
fn put(db: &Connection, scope: &str, kind: &str, uid: &str, v: &Value) -> Result<()> {
    db.execute("INSERT INTO capture_rows(scope,kind,uid,value) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,kind,uid) DO UPDATE SET value=excluded.value",params![scope,kind,uid,v.to_string()]).map(|_|()).map_err(|e|e.to_string())
}
/// 二进制上传也检查epoch；它只准备资源，不能单独产生可执行采集记录。
pub fn upload(
    db: &mut Connection,
    root: &Path,
    scope: &str,
    epoch: u64,
    sha: &str,
    bytes: &[u8],
) -> Result<()> {
    init(db)?;
    if scope.is_empty() || scope.len() > 512 {
        return Err("日志空间无效".into());
    }
    if state(db, scope)?.0 != epoch {
        return Err("日志暂存已清理".into());
    }
    if bytes.is_empty() {
        return Err("日志附件不能为空".into());
    }
    save_resource(root, sha, bytes)
}
/// 内容寻址资源的公共本机写边界；调用方另行校验所属仓储的epoch及元数据事务。
pub fn save_resource(root: &Path, sha: &str, bytes: &[u8]) -> Result<()> {
    save_resource_with_limit(root, sha, bytes, 64 * 1024 * 1024)
}
/// 按调用领域的固定限额校验并发布文件；上界为知识导入既有256MiB，不能由请求任意扩容。
pub fn save_resource_with_limit(root: &Path, sha: &str, bytes: &[u8], limit: usize) -> Result<()> {
    if limit > 256 * 1024 * 1024 || bytes.len() > limit || !digest(sha) {
        return Err("资源无效或超过所属领域的上限".into());
    }
    crate::profile_media::save_verified(root, "capture", sha, bytes).map(|_| ())
}
/// 读取资源同样受数据库epoch围栏保护，清理后的旧句柄不能继续读取旧字节。
pub fn read_checked(
    db: &Connection,
    root: &Path,
    scope: &str,
    epoch: u64,
    sha: &str,
) -> Result<Vec<u8>> {
    init(db)?;
    if scope.is_empty() || scope.len() > 512 {
        return Err("日志空间无效".into());
    }
    if state(db, scope)?.0 != epoch {
        return Err("日志暂存已清理".into());
    }
    read_file(root, sha)
}
/// 所有变更在一个原生事务中比较epoch/完整观察值；文件发布不属于SQLite事务，不在失败时删除共享摘要资源。
pub fn execute(db: &mut Connection, root: &Path, r: Request) -> Result<Value> {
    init(db)?;
    if r.rows.len() > 20000
        || serde_json::to_vec(&r.rows)
            .map_err(|e| e.to_string())?
            .len()
            > 64 * 1024 * 1024
    {
        return Err("日志批量提交超过上限".into());
    }
    if r.scope.is_empty() || r.scope.len() > 512 {
        return Err("日志空间无效".into());
    }
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let (epoch, ready) = state(&tx, &r.scope)?;
    if r.action == "status" {
        return Ok(json!({"epoch":epoch,"ready":ready}));
    }
    if epoch != r.epoch {
        return Err("日志暂存已清理，请重新加载".into());
    }
    let result = match r.action.as_str() {
        "migrate" => {
            if !ready {
                if r.rows.len() > 20000
                    || serde_json::to_vec(&r.rows)
                        .map_err(|e| e.to_string())?
                        .len()
                        > 64 * 1024 * 1024
                {
                    return Err("日志迁移超过上限".into());
                }
                let mut active = false;
                for item in &r.rows {
                    let kind = item["kind"].as_str().ok_or("日志类别缺失")?;
                    let v = &item["value"];
                    validate(root, &r.scope, v)?;
                    let uid = if kind == "active" {
                        if active {
                            return Err("重复日志来源".into());
                        }
                        active = true;
                        "active".to_owned()
                    } else if kind == "archive" {
                        value_hash(v)
                    } else {
                        return Err("日志类别无效".into());
                    };
                    put(&tx, &r.scope, kind, &uid, v)?;
                }
                tx.execute("INSERT INTO capture_state VALUES(?1,?2,1) ON CONFLICT(scope) DO UPDATE SET ready=1",params![r.scope,epoch]).map_err(|e|e.to_string())?;
            }
            Value::Null
        }
        "scopes" => {
            let mut q = tx
                .prepare("SELECT scope FROM capture_state UNION SELECT scope FROM capture_rows")
                .map_err(|e| e.to_string())?;
            let scopes = q
                .query_map([], |v| v.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| e.to_string())?;
            json!(scopes
                .into_iter()
                .filter(|s| s == &r.scope || s.starts_with(&(r.scope.clone() + ":reset:")))
                .collect::<Vec<_>>())
        }
        "read" => read(&tx, &r.scope, "active", "active")?.unwrap_or(Value::Null),
        "archives" => {
            let mut q=tx.prepare("SELECT value FROM capture_rows WHERE scope=?1 AND kind='archive' ORDER BY uid LIMIT 20001").map_err(|e|e.to_string())?;
            let raw = q
                .query_map([&r.scope], |v| v.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| e.to_string())?;
            if raw.len() > 20000 || raw.iter().map(String::len).sum::<usize>() > 64 * 1024 * 1024 {
                return Err("日志档案超过读取上限".into());
            }
            Value::Array(
                raw.into_iter()
                    .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
                    .collect::<Result<Vec<_>>>()?,
            )
        }
        "save" => {
            if !ready {
                return Err("日志尚未完成迁移".into());
            }
            let v = r.value.ok_or("缺少日志")?;
            validate(root, &r.scope, &v)?;
            if read(&tx, &r.scope, "active", "active")?.is_some() {
                return Err("已有未完成日志，请先恢复或放弃".into());
            }
            put(&tx, &r.scope, "active", "active", &v)?;
            Value::Null
        }
        "mark" => {
            let mut v = read(&tx, &r.scope, "active", "active")?.ok_or("日志恢复记录已改变")?;
            if v["operationUid"].as_str() != r.uid.as_deref() {
                return Err("日志恢复记录已改变".into());
            }
            v["committed"] = json!(true);
            put(&tx, &r.scope, "active", "active", &v)?;
            Value::Null
        }
        "clear" => {
            if let Some(v) = read(&tx, &r.scope, "active", "active")? {
                if v["operationUid"].as_str() == r.uid.as_deref() {
                    tx.execute(
                        "DELETE FROM capture_rows WHERE scope=?1 AND kind='active'",
                        [&r.scope],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            Value::Null
        }

        "archive" => {
            if !ready {
                return Err("日志尚未完成迁移".into());
            }
            for v in r.rows {
                validate(root, &r.scope, &v)?;
                put(&tx, &r.scope, "archive", &value_hash(&v), &v)?;
            }
            Value::Null
        }
        "reset" => {
            tx.execute("DELETE FROM capture_rows WHERE scope=?1", [&r.scope])
                .map_err(|e| e.to_string())?;
            tx.execute("INSERT INTO capture_state VALUES(?1,?2,1) ON CONFLICT(scope) DO UPDATE SET epoch=excluded.epoch,ready=1",params![r.scope,epoch+1]).map_err(|e|e.to_string())?;
            Value::Null
        }
        _ => return Err("日志暂存操作无效".into()),
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(scope: &str, action: &str, epoch: u64, value: Value) -> Request {
        serde_json::from_value(json!({"scope":scope,"action":action,"epoch":epoch,"value":value}))
            .unwrap()
    }
    fn row(scope: &str, sha: &str) -> Value {
        json!({"schema":1,"scope":scope,"operationUid":"synthetic-operation","input":{"uid":"synthetic-note","type":"work_log","title":"Synthetic","content":"Synthetic body","captureSource":"quick_log_work"},"text":"Synthetic body","createdAt":"2026-11-13T00:00:00Z","files":[{"uid":"synthetic-file","name":"synthetic.txt","type":"text/plain","lastModified":0,"sha256":sha,"sizeBytes":15}]})
    }
    fn migrate(db: &mut Connection, root: &Path, scope: &str, value: Value) -> Result<Value> {
        let mut r = request(scope, "migrate", 0, Value::Null);
        r.rows = vec![json!({"kind":"active","value":value})];
        execute(db, root, r)
    }
    #[test]
    fn file_validation_precedes_atomic_migration_and_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("db.sqlite");
        let root = dir.path().join("files");
        let mut db = Connection::open(&file).unwrap();
        let sha = hash(b"synthetic bytes");
        let v = row("synthetic", &sha);
        assert!(migrate(&mut db, &root, "synthetic", v.clone()).is_err());
        assert_eq!(state(&db, "synthetic").unwrap(), (0, false));
        upload(&mut db, &root, "synthetic", 0, &sha, b"synthetic bytes").unwrap();
        db.execute_batch("CREATE TRIGGER capture_fail BEFORE INSERT ON capture_state BEGIN SELECT RAISE(ABORT,'synthetic'); END").unwrap();
        assert!(migrate(&mut db, &root, "synthetic", v.clone()).is_err());
        assert!(read(&db, "synthetic", "active", "active")
            .unwrap()
            .is_none());
        assert!(root.join(&sha).is_file());
        db.execute_batch("DROP TRIGGER capture_fail").unwrap();
        migrate(&mut db, &root, "synthetic", v.clone()).unwrap();
        drop(db);
        let mut db = Connection::open(file).unwrap();
        assert_eq!(
            execute(&mut db, &root, request("synthetic", "read", 0, Value::Null)).unwrap(),
            v
        );
        fs::write(root.join(&sha), b"corrupt").unwrap();
        assert!(read_file(&root, &sha).is_err());
    }
    #[test]
    fn reset_retires_old_source_and_fences_late_writes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut db = Connection::open_in_memory().unwrap();
        let sha = hash(b"synthetic bytes");
        upload(&mut db, root, "synthetic", 0, &sha, b"synthetic bytes").unwrap();
        let v = row("synthetic", &sha);
        migrate(&mut db, root, "synthetic", v.clone()).unwrap();
        execute(&mut db, root, request("synthetic", "reset", 0, Value::Null)).unwrap();
        assert_eq!(state(&db, "synthetic").unwrap(), (1, true));
        assert!(execute(&mut db, root, request("synthetic", "save", 0, v.clone())).is_err());
        assert!(upload(&mut db, root, "synthetic", 0, &sha, b"synthetic bytes").is_err());
        let mut r = request("synthetic", "migrate", 1, Value::Null);
        r.rows = vec![json!({"kind":"active","value":v})];
        execute(&mut db, root, r).unwrap();
        assert!(read(&db, "synthetic", "active", "active")
            .unwrap()
            .is_none());
    }
    #[test]
    fn archive_never_activates_and_duplicate_restore_is_flat() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let mut db = Connection::open_in_memory().unwrap();
        let sha = hash(b"synthetic bytes");
        upload(&mut db, root, "synthetic", 0, &sha, b"synthetic bytes").unwrap();
        execute(
            &mut db,
            root,
            request("synthetic", "migrate", 0, Value::Null),
        )
        .unwrap();
        let v = row("synthetic", &sha);
        for _ in 0..2 {
            let mut r = request("synthetic", "archive", 0, Value::Null);
            r.rows = vec![v.clone()];
            execute(&mut db, root, r).unwrap();
        }
        assert!(read(&db, "synthetic", "active", "active")
            .unwrap()
            .is_none());
        assert_eq!(
            execute(
                &mut db,
                root,
                request("synthetic", "archives", 0, Value::Null)
            )
            .unwrap(),
            json!([v])
        );
        assert!(read_file(root, "../escape").is_err());
    }
}

//! 小型业务聚合的持久状态仓储，复用profile数据库及原生真实事务。
use rusqlite::{Connection, OptionalExtension, params};

/// 只读指定业务聚合；缺失返回None，不创建空快照或触发迁移。
pub fn read(db: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    db.query_row("SELECT value FROM metadata WHERE key=?1", [format!("business:{key}")], |r| r.get(0)).optional()
}

/// 诊断按业务前缀读取同一查询快照；超过边界显式失败，不能截断后声称队列为空。
pub fn list(db: &Connection, prefix: &str) -> rusqlite::Result<Vec<(String,String)>> {
    let prefix=format!("business:{prefix}");
    let mut statement=db.prepare("SELECT key,value FROM metadata WHERE substr(key,1,length(?1))=?1 ORDER BY key LIMIT 20001")?;
    let rows=statement.query_map([prefix], |row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?)))?;
    let mut values=Vec::new();let mut bytes=0;
    for row in rows {let (key,value)=row?;bytes+=key.len()+value.len();
        if values.len()>=20000||bytes>32*1024*1024{return Err(rusqlite::Error::InvalidQuery);}
        values.push((key["business:".len()..].to_string(),value));
    }
    Ok(values)
}

/// 比较完整旧快照后原子提交；并发窗口不能覆盖尚未见过的修改。
pub fn write(db: &mut Connection, key: &str, expected: Option<&str>, value: &str) -> rusqlite::Result<bool> {
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if read(&tx, key)?.as_deref() != expected { return Ok(false); }
    tx.execute("INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![format!("business:{key}"),value])?;
    tx.commit()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn prefix_inspection_preserves_tombstones_and_is_read_only(){
  let mut db=Connection::open_in_memory().unwrap();db.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)").unwrap();
  for (key,value) in [("folder-transfer:scope:a","{\"sent\":true}"),("folder-transfer:scope:b","null"),("folder-transfer:other:c","{}"),("notifications:scope:a","[]")]{assert!(write(&mut db,key,None,value).unwrap());}
  let before=db.total_changes();let values=list(&db,"folder-transfer:scope:").unwrap();
  assert_eq!(values,vec![("folder-transfer:scope:a".to_string(),"{\"sent\":true}".to_string()),("folder-transfer:scope:b".to_string(),"null".to_string())]);
  assert_eq!(db.total_changes(),before);
 }
 #[test]
 fn durable_compare_and_swap_preserves_competing_state() {
  let mut db=Connection::open_in_memory().unwrap();db.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)").unwrap();
  assert!(write(&mut db,"notifications:a",None,"{\"pending\":[\"1\"]}").unwrap());
  assert!(!write(&mut db,"notifications:a",None,"{}").unwrap());
  assert_eq!(read(&db,"notifications:a").unwrap().unwrap(),"{\"pending\":[\"1\"]}");
  assert_eq!(read(&db,"notifications:b").unwrap(),None);
 }
 #[test]
 fn committed_state_survives_reopen_and_failed_transaction_keeps_prior_value(){
  let directory=tempfile::tempdir().unwrap();let path=directory.path().join("profile.db");
  {let mut db=Connection::open(&path).unwrap();db.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)").unwrap();assert!(write(&mut db,"knowledge:a",None,"{\"values\":[],\"queue\":[1]}").unwrap());}
  let mut db=Connection::open(&path).unwrap();let old=read(&db,"knowledge:a").unwrap().unwrap();
  db.execute_batch("CREATE TRIGGER reject_business_update BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT,'synthetic full'); END").unwrap();
  assert!(write(&mut db,"knowledge:a",Some(&old),"{}").is_err());assert_eq!(read(&db,"knowledge:a").unwrap().unwrap(),old);
 }

}

//! 学习会话与保存笔记幂等记录的行仓储；所有比较、迁移标记和批量恢复均在真实事务内完成。
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize,Serialize};

/// JSON字符串原样保存以保留比较基线；kind由领域命令限定，UID在数据世代和kind内唯一。
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Row {pub kind:String,pub uid:String,pub value:String}
/// 幂等增加专用表，不清理旧库或重置其他领域的迁移标记。
pub fn initialize(db:&Connection)->rusqlite::Result<()> {db.execute_batch("CREATE TABLE IF NOT EXISTS learning_records(scope TEXT NOT NULL,kind TEXT NOT NULL,uid TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,kind,uid));CREATE TABLE IF NOT EXISTS learning_migrations(scope TEXT PRIMARY KEY);")}
/// 仅返回已提交的迁移标记；缺失不等同源库为空，调用方仍须读取和校验旧源。
pub fn ready(db:&Connection,scope:&str)->rusqlite::Result<bool>{db.query_row("SELECT 1 FROM learning_migrations WHERE scope=?1",[scope],|_|Ok(())).optional().map(|v|v.is_some())}
/// 缺行返回None；数据库失败通过Result保留，不能当作空会话继续写入。
pub fn read(db:&Connection,scope:&str,kind:&str,uid:&str)->rusqlite::Result<Option<String>>{db.query_row("SELECT value FROM learning_records WHERE scope=?1 AND kind=?2 AND uid=?3",params![scope,kind,uid],|r|r.get(0)).optional()}
/// 同一只读事务取得会话及保存日志，备份不能混用两个不同提交时点。
pub fn snapshot(db:&mut Connection,scope:&str)->rusqlite::Result<Vec<Row>>{
 let tx=db.transaction()?;let rows={let mut q=tx.prepare("SELECT kind,uid,value FROM learning_records WHERE scope=?1 ORDER BY kind,uid")?;let rows=q.query_map([scope],|r|Ok(Row{kind:r.get(0)?,uid:r.get(1)?,value:r.get(2)?}))?.collect::<rusqlite::Result<Vec<_>>>()?;rows};tx.commit()?;Ok(rows)
}
/// 会话列表不读取保存操作日志，避免普通打开页面传输无关历史正文。
pub fn list_sessions(db:&Connection,scope:&str)->rusqlite::Result<Vec<Row>>{
 let mut q=db.prepare("SELECT kind,uid,value FROM learning_records WHERE scope=?1 AND kind='sessions' ORDER BY uid")?;
 let rows=q.query_map([scope],|r|Ok(Row{kind:r.get(0)?,uid:r.get(1)?,value:r.get(2)?}))?.collect();rows
}
/// 先比较完整旧行；不匹配时返回false，不把未知并发结果当作可覆盖的新基线。
pub fn compare(db:&mut Connection,scope:&str,kind:&str,uid:&str,expected:Option<&str>,value:Option<&str>)->rusqlite::Result<bool>{
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
 if read(&tx,scope,kind,uid)?.as_deref()!=expected{return Ok(false)}
 if let Some(value)=value{tx.execute("INSERT INTO learning_records(scope,kind,uid,value) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,kind,uid) DO UPDATE SET value=excluded.value",params![scope,kind,uid,value])?;}else{tx.execute("DELETE FROM learning_records WHERE scope=?1 AND kind=?2 AND uid=?3",params![scope,kind,uid])?;}
 tx.commit()?;Ok(true)
}
/// 首次迁移会话和操作日志后再提交标记；失败回滚全部行，重跑不得覆盖已启用的新仓储。
pub fn migrate(db:&mut Connection,scope:&str,rows:&[Row])->rusqlite::Result<()> {
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
 if ready(&tx,scope)?{return Ok(())}
 for row in rows{tx.execute("INSERT INTO learning_records(scope,kind,uid,value) VALUES(?1,?2,?3,?4)",params![scope,row.kind,row.uid,row.value])?;}
 tx.execute("INSERT INTO learning_migrations(scope) VALUES(?1)",[scope])?;tx.commit()
}
/// 整库恢复只补缺失会话，不向活跃操作日志重新授予旧请求执行资格。
pub fn restore(db:&mut Connection,scope:&str,rows:&[Row],fresh:bool)->rusqlite::Result<usize>{
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;let mut restored=0;
 if fresh {let count:i64=tx.query_row("SELECT count(*) FROM learning_records WHERE scope=?1",[scope],|r|r.get(0))?;if count!=0{return Err(rusqlite::Error::InvalidQuery)}}
 for row in rows{restored+=tx.execute("INSERT OR IGNORE INTO learning_records(scope,kind,uid,value) VALUES(?1,'sessions',?2,?3)",params![scope,row.uid,row.value])?;}
 tx.commit()?;Ok(restored)
}
/// 成果草稿和操作日志同事务补缺失；新空间恢复还必须证明目标全空。
pub fn restore_action_rows(db:&mut Connection,scope:&str,rows:&[Row],fresh:bool)->rusqlite::Result<()> {
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
 if fresh {let count:i64=tx.query_row("SELECT count(*) FROM learning_records WHERE scope=?1",[scope],|r|r.get(0))?;if count!=0{return Err(rusqlite::Error::InvalidQuery)}}
 for row in rows{tx.execute("INSERT OR IGNORE INTO learning_records(scope,kind,uid,value) VALUES(?1,?2,?3,?4)",params![scope,row.kind,row.uid,row.value])?;}
 tx.commit()
}
/// 草稿比较及已确认内容冻结必须在同一写事务内，不能在检查后被另一窗口确认再覆盖。
pub fn compare_action_draft(db:&mut Connection,scope:&str,uid:&str,expected:Option<&str>,value:&str)->rusqlite::Result<bool>{
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
 if read(&tx,scope,"drafts",uid)?.as_deref()!=expected{return Ok(false)}
 if let Some(operation)=read(&tx,scope,"operations",uid)? {let Ok(operation)=serde_json::from_str::<serde_json::Value>(&operation)else{return Ok(false)};if operation.get("signature").and_then(|v|v.as_str())!=Some(value){return Ok(false)}}
 tx.execute("INSERT INTO learning_records(scope,kind,uid,value) VALUES(?1,'drafts',?2,?3) ON CONFLICT(scope,kind,uid) DO UPDATE SET value=excluded.value",params![scope,uid,value])?;
 tx.commit()?;Ok(true)
}
/// 首次确认同时比较最新草稿；后续检查点必须保留原签名，避免检查草稿后被并发修改再确认旧内容。
pub fn compare_action_operation(db:&mut Connection,scope:&str,uid:&str,expected:Option<&str>,value:&str)->rusqlite::Result<bool>{
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;let current=read(&tx,scope,"operations",uid)?;
 if current.as_deref()!=expected{return Ok(false)}
 let Ok(next)=serde_json::from_str::<serde_json::Value>(value)else{return Ok(false)};let Some(signature)=next.get("signature").and_then(|v|v.as_str())else{return Ok(false)};
 if let Some(current)=current{let Ok(current)=serde_json::from_str::<serde_json::Value>(&current)else{return Ok(false)};if current.get("signature").and_then(|v|v.as_str())!=Some(signature){return Ok(false)}}else if read(&tx,scope,"drafts",uid)?.as_deref()!=Some(signature){return Ok(false)}
 tx.execute("INSERT INTO learning_records(scope,kind,uid,value) VALUES(?1,'operations',?2,?3) ON CONFLICT(scope,kind,uid) DO UPDATE SET value=excluded.value",params![scope,uid,value])?;tx.commit()?;Ok(true)
}
#[cfg(test)]mod tests{
 use super::*;
 fn row(uid:&str)->Row{Row{kind:"sessions".into(),uid:uid.into(),value:format!("{{\"uid\":\"{uid}\"}}")}}
 #[test]fn migration_is_atomic_idempotent_and_scope_isolated(){let mut db=Connection::open_in_memory().unwrap();initialize(&db).unwrap();assert!(migrate(&mut db,"a",&[row("same"),row("same")]).is_err());assert!(!ready(&db,"a").unwrap());assert!(snapshot(&mut db,"a").unwrap().is_empty());migrate(&mut db,"a",&[row("one")]).unwrap();migrate(&mut db,"a",&[row("two")]).unwrap();assert_eq!(snapshot(&mut db,"a").unwrap().len(),1);assert!(snapshot(&mut db,"b").unwrap().is_empty());}
 #[test]fn comparison_reopen_and_failed_write_preserve_committed_records(){let dir=tempfile::tempdir().unwrap();let path=dir.path().join("profile.db");{let mut db=Connection::open(&path).unwrap();initialize(&db).unwrap();migrate(&mut db,"a",&[row("one")]).unwrap();}let mut db=Connection::open(&path).unwrap();let old=read(&db,"a","sessions","one").unwrap().unwrap();assert!(!compare(&mut db,"a","sessions","one",None,Some("{}" )).unwrap());db.execute_batch("CREATE TRIGGER reject_learning BEFORE UPDATE ON learning_records BEGIN SELECT RAISE(ABORT,'synthetic full'); END").unwrap();assert!(compare(&mut db,"a","sessions","one",Some(&old),Some("{}")).is_err());assert_eq!(read(&db,"a","sessions","one").unwrap(),Some(old));assert!(ready(&db,"a").unwrap());}
 #[test]fn restore_keeps_existing_sessions_and_never_replays_operations(){let mut db=Connection::open_in_memory().unwrap();initialize(&db).unwrap();migrate(&mut db,"a",&[row("one")]).unwrap();assert!(restore(&mut db,"a",&[row("two")],true).is_err());assert!(read(&db,"a","sessions","two").unwrap().is_none());assert_eq!(restore(&mut db,"a",&[row("one"),row("two")],false).unwrap(),1);assert_eq!(restore(&mut db,"a",&[row("one"),row("two")],false).unwrap(),0);assert!(read(&db,"a","operations","two").unwrap().is_none());}
 #[test]fn confirmed_action_drafts_freeze_in_the_same_transaction(){
  let mut db=Connection::open_in_memory().unwrap();initialize(&db).unwrap();let draft="{\"uid\":\"draft\",\"title\":\"confirmed\"}";
  assert!(compare_action_draft(&mut db,"actions:a","draft",None,draft).unwrap());
  let operation=serde_json::json!({"uid":"draft","signature":draft,"lease":"first"}).to_string();let peer=draft.replace("confirmed","peer");assert!(compare_action_draft(&mut db,"actions:a","draft",Some(draft),&peer).unwrap());assert!(!compare_action_operation(&mut db,"actions:a","draft",None,&operation).unwrap());assert!(compare_action_draft(&mut db,"actions:a","draft",Some(&peer),draft).unwrap());assert!(compare_action_operation(&mut db,"actions:a","draft",None,&operation).unwrap());
  assert!(!compare_action_draft(&mut db,"actions:a","draft",Some(draft),"{\"uid\":\"draft\",\"title\":\"stale\"}").unwrap());assert_eq!(read(&db,"actions:a","drafts","draft").unwrap().as_deref(),Some(draft));
 }
 #[test]fn action_takeover_fences_old_renewal_and_release_and_restore_rolls_back(){
  let mut db=Connection::open_in_memory().unwrap();initialize(&db).unwrap();let first="{\"uid\":\"op\",\"lease\":\"first\",\"results\":[{\"uid\":\"stable-result\"}]}";let second=first.replace("first","second");
  assert!(compare(&mut db,"actions:a","operations","op",None,Some(first)).unwrap());assert!(compare(&mut db,"actions:a","operations","op",Some(first),Some(&second)).unwrap());
  assert!(!compare(&mut db,"actions:a","operations","op",Some(first),Some("{}")).unwrap());assert_eq!(read(&db,"actions:a","operations","op").unwrap(),Some(second));
  let rows=[Row{kind:"drafts".into(),uid:"draft".into(),value:"{}".into()},Row{kind:"operations".into(),uid:"restore".into(),value:"{}".into()}];
  db.execute_batch("CREATE TRIGGER reject_action_restore BEFORE INSERT ON learning_records WHEN NEW.kind='operations' AND NEW.uid='restore' BEGIN SELECT RAISE(ABORT,'synthetic full'); END").unwrap();
  assert!(restore_action_rows(&mut db,"actions:b",&rows,true).is_err());assert!(snapshot(&mut db,"actions:b").unwrap().is_empty());
  assert!(restore_action_rows(&mut db,"actions:a",&rows,true).is_err());assert!(read(&db,"a","operations","op").unwrap().is_none());
 }

}

//! 笔记历史与文本恢复草稿：原生行仓储，迁移和业务提交均使用真实SQLite事务。
use rusqlite::{Connection,OptionalExtension,params};
use serde::{Deserialize,Serialize};
use serde_json::Value;
/// 单条文本记录；uid须与JSON内身份一致，字节与批量上限由命令入口校验。
#[derive(Clone,Deserialize,Serialize)]
pub struct Row{pub uid:String,pub value:String}
pub fn initialize(db:&Connection)->rusqlite::Result<()>{db.execute_batch("CREATE TABLE IF NOT EXISTS review_records(scope TEXT NOT NULL,kind TEXT NOT NULL,uid TEXT NOT NULL,group_uid TEXT NOT NULL,stamp INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,kind,uid));CREATE INDEX IF NOT EXISTS review_group ON review_records(scope,kind,group_uid,stamp);CREATE UNIQUE INDEX IF NOT EXISTS review_history_identity ON review_records(uid) WHERE kind='history';CREATE TABLE IF NOT EXISTS review_retired_owners(scope TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(scope,kind));CREATE TABLE IF NOT EXISTS review_migrations(scope TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(scope,kind));")}
/// 已迁移或已明确抹除的旧源均视为退役，不能在空库时自动重导入。
pub fn ready(db:&Connection,scope:&str,kind:&str)->rusqlite::Result<bool>{Ok(db.query_row("SELECT 1 FROM review_migrations WHERE scope=?1 AND kind=?2 UNION ALL SELECT 1 FROM review_retired_owners WHERE kind=?2 AND (scope=?1 OR substr(?1,1,length(scope)+7)=scope||':reset:') LIMIT 1",[scope,kind],|_|Ok(())).optional()?.is_some())}
pub fn read(db:&Connection,scope:&str,kind:&str,uid:&str)->rusqlite::Result<Option<String>>{db.query_row("SELECT value FROM review_records WHERE scope=?1 AND kind=?2 AND uid=?3",[scope,kind,uid],|r|r.get(0)).optional()}
pub fn list(db:&Connection,scope:&str,kind:&str,group:Option<&str>)->rusqlite::Result<Vec<Row>>{
 let mut statement=db.prepare("SELECT uid,value FROM review_records WHERE scope=?1 AND kind=?2 AND (?3 IS NULL OR group_uid=?3) ORDER BY stamp DESC,uid DESC LIMIT 20001")?;
 let rows=statement.query_map(params![scope,kind,group],|r|Ok(Row{uid:r.get(0)?,value:r.get(1)?}))?;
 let mut values=Vec::new();let mut bytes=0;
 for row in rows{let row=row?;bytes+=row.value.len();if values.len()>=20000||bytes>64*1024*1024{return Err(rusqlite::Error::InvalidQuery)}values.push(row)}Ok(values)
}
fn payload(scope:&str,kind:&str,row:&Row)->rusqlite::Result<(Value,String,i64)>{
 let value:Value=serde_json::from_str(&row.value).map_err(|_|rusqlite::Error::InvalidQuery)?;
 if value.get("scope").and_then(Value::as_str)!=Some(scope)||value.get(if kind=="history"{"id"}else{"key"}).and_then(Value::as_str)!=Some(&row.uid){return Err(rusqlite::Error::InvalidQuery)}
 let group=if kind=="history"{value.get("noteUid").and_then(Value::as_str).filter(|s|!s.is_empty()).ok_or(rusqlite::Error::InvalidQuery)?.to_string()}else{String::new()};
 let stamp=value.get(if kind=="history"{"createdAt"}else{"updatedAt"}).and_then(Value::as_str).ok_or(rusqlite::Error::InvalidQuery)?;
 let stamp=chrono::DateTime::parse_from_rfc3339(stamp).map_err(|_|rusqlite::Error::InvalidQuery)?.timestamp_millis();
 if kind=="history"&&(["title","content"].iter().any(|k|!value.get(k).is_some_and(Value::is_string))||!value.get("summary").is_some_and(|v|v.is_null()||v.is_string())||!value.get("reason").and_then(Value::as_str).is_some_and(|v|["edit","delete","restore","remote"].contains(&v))){return Err(rusqlite::Error::InvalidQuery)}
 if kind!="history"&&!valid_draft(&value,kind){return Err(rusqlite::Error::InvalidQuery)}
 Ok((value,group,stamp))
}
fn valid_draft(value:&Value,kind:&str)->bool{
 if kind=="archives"{return value.get("source").is_some_and(|s|s.get("scope").is_some_and(Value::is_string)&&s.get("kind").and_then(Value::as_str).is_some_and(|k|["series","consolidation"].contains(&k))&&s.get("drafts").is_some_and(Value::is_array))}
 if kind=="consolidation"{return ["sourceHash","title","content","folderUid","mode","instruction","operationUid"].iter().all(|key|value.get(key).is_some_and(Value::is_string))&&value.get("ready").is_some_and(Value::is_boolean)}
 if kind=="series"{return value.get("sessionUid").and_then(Value::as_str).is_some_and(|s|!s.is_empty())&&value.get("instruction").is_some_and(Value::is_string)&&value.get("allowSameTitle").is_some_and(Value::is_boolean)&&value.get("plan").is_some_and(|p|p.get("assessment").is_some_and(Value::is_string)&&p.get("notes").and_then(Value::as_array).is_some_and(|n|!n.is_empty()&&n.len()<=30)&&p.get("folders").and_then(Value::as_array).is_some_and(|n|n.len()<=40))&&value.get("target").is_some_and(Value::is_object)&&value.get("progress").is_some_and(|p|p.get("started").is_some_and(Value::is_boolean)&&p.get("notes").is_some_and(Value::is_array)&&p.get("folders").is_some_and(Value::is_object))}
 false
}
fn insert(db:&Connection,scope:&str,kind:&str,row:&Row)->rusqlite::Result<()>{let (_,group,stamp)=payload(scope,kind,row)?;db.execute("INSERT INTO review_records(scope,kind,uid,group_uid,stamp,value) VALUES(?1,?2,?3,?4,?5,?6)",params![scope,kind,row.uid,group,stamp,row.value])?;Ok(())}
/// 行与标记一起提交；任何坏源/约束/磁盘失败均回滚，旧IDB由调用方只读保留。
pub fn migrate(db:&mut Connection,scope:&str,kind:&str,rows:&[Row])->rusqlite::Result<()>{let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;if ready(&tx,scope,kind)?{return Ok(())}for row in rows{insert(&tx,scope,kind,row)?;}if kind=="history"{tx.execute("DELETE FROM review_records WHERE scope=?1 AND kind='history' AND uid IN (SELECT uid FROM (SELECT uid,row_number() OVER(PARTITION BY group_uid ORDER BY stamp DESC,uid DESC) AS position FROM review_records WHERE scope=?1 AND kind='history') WHERE position>50)",[scope])?;}tx.execute("INSERT INTO review_migrations(scope,kind) VALUES(?1,?2)",[scope,kind])?;tx.commit()}
/// 草稿比较完整观察值后提交，不能刷新基线强行覆盖另一窗口的新状态。
pub fn compare(db:&mut Connection,scope:&str,kind:&str,uid:&str,expected:Option<&str>,value:Option<&str>)->rusqlite::Result<bool>{
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;if read(&tx,scope,kind,uid)?.as_deref()!=expected{return Ok(false)}
 tx.execute("DELETE FROM review_records WHERE scope=?1 AND kind=?2 AND uid=?3",[scope,kind,uid])?;
 if let Some(value)=value{insert(&tx,scope,kind,&Row{uid:uid.into(),value:value.into()})?;}tx.commit()?;Ok(true)
}
fn trim(db:&Connection,scope:&str,note:&str,limit:usize)->rusqlite::Result<()>{db.execute("DELETE FROM review_records WHERE scope=?1 AND kind='history' AND group_uid=?2 AND uid NOT IN (SELECT uid FROM review_records WHERE scope=?1 AND kind='history' AND group_uid=?2 ORDER BY stamp DESC,uid DESC LIMIT ?3)",params![scope,note,limit])?;Ok(())}
/// 去重、同一时钟下的递增时间及50条裁剪属于同一事务，不先查后跨连接追加。
pub fn append(db:&mut Connection,scope:&str,row:&Row,limit:usize)->rusqlite::Result<()>{
 let (mut value,note,mut stamp)=payload(scope,"history",row)?;let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
 if let Some(raw)=read(&tx,scope,"history",&row.uid)?{let prior:Value=serde_json::from_str(&raw).map_err(|_|rusqlite::Error::InvalidQuery)?;if ["noteUid","title","content","summary","sourceVersion","reason"].iter().all(|key|prior.get(key)==value.get(key)){return Ok(())}return Err(rusqlite::Error::InvalidQuery)}
 let latest:Option<(String,i64)>=tx.query_row("SELECT value,stamp FROM review_records WHERE scope=?1 AND kind='history' AND group_uid=?2 ORDER BY stamp DESC,uid DESC LIMIT 1",[scope,&note],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
 if let Some((raw,last))=latest{let prior:Value=serde_json::from_str(&raw).map_err(|_|rusqlite::Error::InvalidQuery)?;if ["title","content","summary"].iter().all(|key|prior.get(key)==value.get(key)){return Ok(())}if stamp<=last{stamp=last.checked_add(1).ok_or(rusqlite::Error::InvalidQuery)?;let time=chrono::DateTime::from_timestamp_millis(stamp).ok_or(rusqlite::Error::InvalidQuery)?;value["createdAt"]=Value::String(time.to_rfc3339_opts(chrono::SecondsFormat::Millis,true));}}
 insert(&tx,scope,"history",&Row{uid:row.uid.clone(),value:value.to_string()})?;trim(&tx,scope,&note,limit)?;tx.commit()
}
/// 恢复仅补缺失行；历史ID绑定原笔记，冲突时整批回滚，不覆盖本机更新。
pub fn restore(db:&mut Connection,scope:&str,kind:&str,rows:&[Row],fresh:bool)->rusqlite::Result<()>{
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;let mut notes=std::collections::HashSet::new();
 if fresh{let count:i64=tx.query_row("SELECT count(*) FROM review_records WHERE scope=?1 AND kind=?2",[scope,kind],|r|r.get(0))?;if count!=0{return Err(rusqlite::Error::InvalidQuery)}}
 for row in rows{let (_,group,_)=payload(scope,kind,row)?;
  if kind=="history"{let found:Option<(String,String)>=tx.query_row("SELECT scope,group_uid FROM review_records WHERE kind='history' AND uid=?1",[&row.uid],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;if found.as_ref().is_some_and(|(s,n)|s!=scope||n!=&group){return Err(rusqlite::Error::InvalidQuery)}notes.insert(group);}
  let existing=read(&tx,scope,kind,&row.uid)?;if kind=="archives"&&existing.as_ref().is_some_and(|v|v!=&row.value){return Err(rusqlite::Error::InvalidQuery)}if existing.is_none(){insert(&tx,scope,kind,row)?;}
 }
 for note in notes{trim(&tx,scope,&note,50)?;}tx.commit()
}
/// 显式删除仍保留迁移标记；抹除账号还退役未打开的旧世代，防止旧源复活。
pub fn clear(db:&mut Connection,scope:&str,kind:&str,group:Option<&str>,owner:bool)->rusqlite::Result<()>{
 let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
 tx.execute("DELETE FROM review_records WHERE kind=?2 AND (scope=?1 OR (?4 AND substr(scope,1,length(?1)+7)=?1||':reset:')) AND (?3 IS NULL OR group_uid=?3)",params![scope,kind,group,owner])?;if owner{tx.execute("INSERT OR IGNORE INTO review_retired_owners(scope,kind) VALUES(?1,?2)",[scope,kind])?;}tx.commit()
}

#[cfg(test)]mod tests{
 use super::*;
 fn history(scope:&str,id:&str,note:&str,body:&str)->Row{Row{uid:id.into(),value:serde_json::json!({"id":id,"scope":scope,"noteUid":note,"title":"合成历史","content":body,"summary":null,"sourceVersion":1,"reason":"edit","createdAt":"2026-11-12T00:00:00.000Z"}).to_string()}}
 fn draft(scope:&str,key:&str,body:&str)->Row{Row{uid:key.into(),value:serde_json::json!({"key":key,"scope":scope,"sourceHash":"synthetic","title":"合成稿","content":body,"folderUid":"","mode":"整理","instruction":"","operationUid":"","ready":false,"updatedAt":"2026-11-12T00:00:00.000Z"}).to_string()}}
 #[test]fn migration_rolls_back_bad_or_duplicate_sources_and_commits_marker_once(){
  let mut db=Connection::open_in_memory().unwrap();initialize(&db).unwrap();let row=history("a","one","note","原正文");
  assert!(migrate(&mut db,"a","history",&[row.clone(),row.clone()]).is_err());assert!(!ready(&db,"a","history").unwrap());assert!(list(&db,"a","history",None).unwrap().is_empty());
  migrate(&mut db,"a","history",&[row]).unwrap();migrate(&mut db,"a","history",&[history("a","later","note","旧库迟到")]).unwrap();assert_eq!(list(&db,"a","history",None).unwrap().len(),1);
  let legacy=(0..60).map(|n|history("c",&format!("legacy-{n}"),"legacy-note",&format!("旧正文{n}"))).collect::<Vec<_>>();migrate(&mut db,"c","history",&legacy).unwrap();assert_eq!(list(&db,"c","history",Some("legacy-note")).unwrap().len(),50);
  assert!(migrate(&mut db,"b","history",&[history("a","bad","note","其他空间")]).is_err());assert!(!ready(&db,"b","history").unwrap());
 }
 #[test]fn append_dedup_time_limit_and_identity_are_one_transaction(){
  let mut db=Connection::open_in_memory().unwrap();initialize(&db).unwrap();
  for n in 0..60{append(&mut db,"a",&history("a",&format!("id{n}"),"note",&format!("正文{n}")),50).unwrap();}
  let rows=list(&db,"a","history",Some("note")).unwrap();assert_eq!(rows.len(),50);let newest:Value=serde_json::from_str(&rows[0].value).unwrap();assert_eq!(newest["content"],"正文59");assert_eq!(newest["createdAt"],"2026-11-12T00:00:00.059Z");
  append(&mut db,"a",&history("a","duplicate","note","正文59"),50).unwrap();assert_eq!(list(&db,"a","history",None).unwrap().len(),50);
  assert!(append(&mut db,"b",&history("b","id59","foreign","外来"),50).is_err());assert!(list(&db,"b","history",None).unwrap().is_empty());
  db.execute_batch("CREATE TRIGGER fail_history BEFORE DELETE ON review_records WHEN OLD.kind='history' BEGIN SELECT RAISE(ABORT,'synthetic full'); END").unwrap();
  assert!(append(&mut db,"a",&history("a","failed","note","提交失败"),50).is_err());assert!(read(&db,"a","history","failed").unwrap().is_none());assert_eq!(list(&db,"a","history",None).unwrap().len(),50);
 }
 #[test]fn restore_conflict_rolls_back_missing_rows_and_keeps_existing_content(){
  let mut db=Connection::open_in_memory().unwrap();initialize(&db).unwrap();let prior=history("a","one","note","已保存");migrate(&mut db,"a","history",&[prior.clone()]).unwrap();
  restore(&mut db,"a","history",&[history("a","one","note","旧备份")],false).unwrap();assert_eq!(read(&db,"a","history","one").unwrap().unwrap(),prior.value);
  assert!(restore(&mut db,"a","history",&[history("a","fresh","note","新空间检查")],true).is_err());assert!(read(&db,"a","history","fresh").unwrap().is_none());
  assert!(restore(&mut db,"b","history",&[history("b","new","note","新行"),history("b","one","note","撞ID")],false).is_err());assert!(read(&db,"b","history","new").unwrap().is_none());
 }
 #[test]fn draft_cas_reopen_failure_and_owner_retirement_preserve_authority(){
  let dir=tempfile::tempdir().unwrap();let path=dir.path().join("profile.db");let first=draft("a","key","原稿");
  {let mut db=Connection::open(&path).unwrap();initialize(&db).unwrap();migrate(&mut db,"a","consolidation",&[first.clone()]).unwrap();}
  let mut db=Connection::open(&path).unwrap();let next=draft("a","key","新稿");assert!(compare(&mut db,"a","consolidation","key",Some(&first.value),Some(&next.value)).unwrap());assert!(!compare(&mut db,"a","consolidation","key",Some(&first.value),None).unwrap());
  db.execute_batch("CREATE TRIGGER reject_draft BEFORE INSERT ON review_records WHEN NEW.kind='consolidation' BEGIN SELECT RAISE(ABORT,'synthetic full'); END").unwrap();
  assert!(compare(&mut db,"a","consolidation","key",Some(&next.value),Some(&first.value)).is_err());assert_eq!(read(&db,"a","consolidation","key").unwrap().unwrap(),next.value);
  clear(&mut db,"a","consolidation",None,true).unwrap();assert!(ready(&db,"a:reset:unopened","consolidation").unwrap());assert!(!ready(&db,"ab:reset:unopened","consolidation").unwrap());
  migrate(&mut db,"a:reset:unopened","consolidation",&[draft("a:reset:unopened","old-key","旧库未打开")]).unwrap();assert!(list(&db,"a:reset:unopened","consolidation",None).unwrap().is_empty());
 }
}

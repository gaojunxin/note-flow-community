//! 任务关联与阅读修订仓储：一个命令内完成真实事务，不将前端IDB事务模拟成SQL循环。
use rusqlite::{OptionalExtension,params};
pub use rusqlite::{Connection,Error,TransactionBehavior};
pub type StoreResult<T>=rusqlite::Result<T>;
use serde::Deserialize;
use serde_json::{Value,json};
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Request{pub domain:String,pub action:String,#[serde(default)]pub epoch:u64,pub uid:Option<String>,pub value:Option<Value>,pub expected:Option<Value>,pub operation:Option<Value>,pub saved:Option<Value>,pub task_uid:Option<String>,pub before:Option<Value>,#[serde(default)]pub values:Vec<Value>,#[serde(default)]pub rows:Vec<Row>}
#[derive(Deserialize,Clone)]
pub struct Row{pub kind:String,pub uid:String,pub value:Value}
pub fn initialize(db:&Connection)->rusqlite::Result<()>{db.execute_batch("CREATE TABLE IF NOT EXISTS client_intent_records(scope TEXT NOT NULL,domain TEXT NOT NULL,kind TEXT NOT NULL,uid TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,domain,kind,uid));CREATE TABLE IF NOT EXISTS client_intent_state(scope TEXT NOT NULL,domain TEXT NOT NULL,epoch INTEGER NOT NULL,ready INTEGER NOT NULL,PRIMARY KEY(scope,domain));")}
fn invalid<T>()->rusqlite::Result<T>{Err(rusqlite::Error::InvalidQuery)}
fn text<'a>(v:&'a Value,k:&str)->Option<&'a str>{v.get(k).and_then(Value::as_str)}
pub fn same_endpoint(a:&Value,b:&Value)->bool{["taskUid","noteUid","relationType"].iter().all(|k|a.get(k)==b.get(k))}
pub fn valid_relation(v:&Value)->bool{["uid","taskUid","noteUid","relationType"].iter().all(|k|text(v,k).is_some_and(|s|!s.is_empty()&&s.len()<=1024))&&v.get("version").and_then(Value::as_u64).is_some_and(|n|n<=9007199254740991)&&v.get("deleted").is_none_or(Value::is_boolean)}
pub fn valid_operation(v:&Value)->bool{text(v,"action").is_some_and(|s|["create","delete"].contains(&s))&&v.get("value").is_some_and(|r|valid_relation(r)&&text(r,"uid")==text(v,"uid"))}
fn valid_reading(v:&Value)->bool{
 let n=|k:&str|v.get(k).and_then(Value::as_f64);let page=n("page");let pages=n("pages");
 page.is_some_and(|p|p>=1.0&&p.fract()==0.0)&&pages.is_some_and(|p|p>=1.0&&p.fract()==0.0)&&page<=pages&&n("offset").is_some_and(|n|(0.0..=1.0).contains(&n))&&n("zoom").is_some_and(|n|(0.25..=3.0).contains(&n))&&v.get("version").and_then(Value::as_u64).is_some_and(|n|n<=9007199254740991)&&text(v,"operationId").is_some_and(|s|!s.is_empty()&&s.len()<=1024)&&v.get("dirty").is_some_and(Value::is_boolean)
}
fn valid_row(domain:&str,row:&Row)->bool{
 if row.uid.is_empty()||row.uid.len()>1024||row.value.to_string().len()>32*1024*1024{return false}
 if row.kind=="archive"{return row.value.is_object()}
 if domain=="reading"{return row.kind=="reading"&&row.uid.len()==64&&row.uid.bytes().all(|b|b.is_ascii_hexdigit())&&valid_reading(&row.value)}
 match row.kind.as_str(){"relations"=>valid_relation(&row.value)&&text(&row.value,"uid")==Some(&row.uid),"pending"=>valid_operation(&row.value)&&text(&row.value,"uid")==Some(&row.uid),_=>false}
}
pub fn status(db:&Connection,scope:&str,domain:&str)->rusqlite::Result<(u64,bool)>{Ok(db.query_row("SELECT epoch,ready FROM client_intent_state WHERE scope=?1 AND domain=?2",[scope,domain],|r|Ok((r.get(0)?,r.get::<_,i64>(1)?!=0))).optional()?.unwrap_or((0,false)))}
pub fn read(db:&Connection,scope:&str,domain:&str,kind:&str,uid:&str)->rusqlite::Result<Option<Value>>{let raw:Option<String>=db.query_row("SELECT value FROM client_intent_records WHERE scope=?1 AND domain=?2 AND kind=?3 AND uid=?4",[scope,domain,kind,uid],|r|r.get(0)).optional()?;raw.map(|raw|serde_json::from_str(&raw).map_err(|_|rusqlite::Error::InvalidQuery)).transpose()}
pub fn put(db:&Connection,scope:&str,domain:&str,kind:&str,uid:&str,value:&Value)->rusqlite::Result<()>{let row=Row{kind:kind.into(),uid:uid.into(),value:value.clone()};if !valid_row(domain,&row){return invalid()}db.execute("INSERT INTO client_intent_records(scope,domain,kind,uid,value) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(scope,domain,kind,uid) DO UPDATE SET value=excluded.value",params![scope,domain,kind,uid,value.to_string()])?;Ok(())}
pub fn remove(db:&Connection,scope:&str,domain:&str,kind:&str,uid:&str)->rusqlite::Result<()>{db.execute("DELETE FROM client_intent_records WHERE scope=?1 AND domain=?2 AND kind=?3 AND uid=?4",[scope,domain,kind,uid])?;Ok(())}
pub fn rows(db:&Connection,scope:&str,domain:&str)->rusqlite::Result<Vec<Row>>{let mut stmt=db.prepare("SELECT kind,uid,value FROM client_intent_records WHERE scope=?1 AND domain=?2 ORDER BY kind,uid LIMIT 20001")?;let rows=stmt.query_map([scope,domain],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?;let mut all=Vec::new();let mut bytes=0;for row in rows{let(kind,uid,raw)=row?;bytes+=raw.len();if all.len()>=20000||bytes>64*1024*1024{return invalid()}let row=Row{kind,uid,value:serde_json::from_str(&raw).map_err(|_|rusqlite::Error::InvalidQuery)?};if !valid_row(domain,&row){return invalid()}all.push(row)}Ok(all)}
pub fn snapshot(db:&Connection,scope:&str)->rusqlite::Result<Value>{let all=rows(db,scope,"task-notes")?;Ok(json!({"relations":all.iter().filter(|r|r.kind=="relations").map(|r|r.value.clone()).collect::<Vec<_>>(),"pending":all.iter().filter(|r|r.kind=="pending").map(|r|r.value.clone()).collect::<Vec<_>>()}))}
/// 所有动作在一个连接的真实事务内检查epoch。clear提交后，旧句柄/回执不能复活已清理的意图。
pub fn execute(db:&mut Connection,scope:&str,r:Request)->rusqlite::Result<Value>{
 if r.values.len()>20000||r.values.iter().map(|v|v.to_string().len()).sum::<usize>()>64*1024*1024||!["task-notes","reading"].contains(&r.domain.as_str())||r.rows.len()>20000||r.rows.iter().any(|row|!valid_row(&r.domain,row))||r.rows.iter().map(|row|row.value.to_string().len()).sum::<usize>()>64*1024*1024{return invalid()}
 initialize(db)?;let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;let(epoch,ready)=status(&tx,scope,&r.domain)?;
 if r.action=="status"{return Ok(json!({"epoch":epoch,"ready":ready}))}if !ready&&!["rows","read","snapshot","migrate","clear"].contains(&r.action.as_str()){return invalid()}if epoch!=r.epoch{return invalid()}
 let domain=r.domain.as_str();let uid=r.uid.as_deref().unwrap_or_default();let mut result=Value::Null;
 match r.action.as_str(){
 "migrate"=>{if !ready{for row in &r.rows{tx.execute("INSERT INTO client_intent_records(scope,domain,kind,uid,value) VALUES(?1,?2,?3,?4,?5)",params![scope,domain,row.kind,row.uid,row.value.to_string()])?;}tx.execute("INSERT INTO client_intent_state(scope,domain,epoch,ready) VALUES(?1,?2,?3,1) ON CONFLICT(scope,domain) DO UPDATE SET ready=1",params![scope,domain,epoch])?;}},
 "rows"=>{result=Value::Array(rows(&tx,scope,domain)?.into_iter().map(|r|json!({"kind":r.kind,"uid":r.uid,"value":r.value})).collect())},
 "snapshot" if domain=="task-notes"=>result=snapshot(&tx,scope)?,
 "read" if domain=="reading"=>{result=read(&tx,scope,domain,"reading",uid)?.unwrap_or(Value::Null);if !result.is_null()&&!valid_reading(&result){return invalid()}},
 "compare" if domain=="reading"=>{let prior=read(&tx,scope,domain,"reading",uid)?;if prior.as_ref()!=r.expected.as_ref().filter(|v|!v.is_null()){return invalid()}let value=r.value.as_ref().ok_or(rusqlite::Error::InvalidQuery)?;put(&tx,scope,domain,"reading",uid,value)?;},
 "archive"=>{let value=r.value.as_ref().ok_or(rusqlite::Error::InvalidQuery)?;if let Some(prior)=read(&tx,scope,domain,"archive",uid)?{if prior!=*value{return invalid()}}else{put(&tx,scope,domain,"archive",uid,value)?;}},
 "clear"=>{if domain=="task-notes"&&r.expected.as_ref().is_some_and(|v|snapshot(&tx,scope).map(|s|s["pending"]!=*v).unwrap_or(true)){return invalid()}tx.execute("DELETE FROM client_intent_records WHERE scope=?1 AND domain=?2 AND kind<>'archive'",[scope,domain])?;if let Some(value)=&r.value{put(&tx,scope,domain,"archive",uid,value)?;}tx.execute("INSERT INTO client_intent_state(scope,domain,epoch,ready) VALUES(?1,?2,?3,1) ON CONFLICT(scope,domain) DO UPDATE SET epoch=excluded.epoch,ready=1",params![scope,domain,epoch+1])?;},
 _=>return invalid(),
 }
 tx.commit()?;Ok(result)
}

#[cfg(test)]mod tests{
 use super::*;
 fn call(db:&mut Connection,scope:&str,domain:&str,action:&str,data:Value)->rusqlite::Result<Value>{let mut request=json!({"domain":domain,"action":action,"epoch":0});for(key,value)in data.as_object().unwrap(){request[key]=value.clone()}execute(db,scope,serde_json::from_value(request).unwrap())}
 fn relation(uid:&str,version:u64)->Value{json!({"uid":uid,"taskUid":"task","noteUid":"note","relationType":"reference","version":version})}
 fn op(uid:&str,action:&str,version:u64)->Value{json!({"uid":uid,"action":action,"value":relation(uid,version)})}
 fn init(db:&mut Connection,domain:&str){call(db,"scope",domain,"migrate",json!({"rows":[]})).unwrap();}
 #[test]fn migration_is_atomic_durable_and_does_not_reimport_after_clear(){
  let dir=tempfile::tempdir().unwrap();let path=dir.path().join("profile.db");let mut db=Connection::open(&path).unwrap();let row=json!({"kind":"relations","uid":"one","value":relation("one",0)});
  assert!(call(&mut db,"scope","task-notes","migrate",json!({"rows":[row.clone(),row.clone()]})).is_err());assert_eq!(call(&mut db,"scope","task-notes","status",json!({})).unwrap()["ready"],false);
  call(&mut db,"scope","task-notes","migrate",json!({"rows":[row.clone()]})).unwrap();drop(db);let mut db=Connection::open(&path).unwrap();assert_eq!(call(&mut db,"scope","task-notes","snapshot",json!({})).unwrap()["relations"][0]["uid"],"one");
  call(&mut db,"scope","task-notes","clear",json!({})).unwrap();assert!(call(&mut db,"scope","task-notes","rows",json!({})).is_err());call(&mut db,"scope","task-notes","migrate",json!({"epoch":1,"rows":[row]})).unwrap();assert!(call(&mut db,"scope","task-notes","snapshot",json!({"epoch":1})).unwrap()["relations"].as_array().unwrap().is_empty());
 }
 #[test]fn reading_cas_failure_clear_and_inert_archive_preserve_revisions(){
  let mut db=Connection::open_in_memory().unwrap();init(&mut db,"reading");let sha="a".repeat(64);let first=json!({"page":2,"pages":9,"offset":0.2,"zoom":1,"version":0,"operationId":"first","dirty":true});call(&mut db,"scope","reading","compare",json!({"uid":sha,"expected":null,"value":first})).unwrap();let mut next=first.clone();next["operationId"]=json!("next");next["page"]=json!(3);call(&mut db,"scope","reading","compare",json!({"uid":sha,"expected":first,"value":next})).unwrap();let mut receipt=first.clone();receipt["dirty"]=json!(false);receipt["version"]=json!(1);assert!(call(&mut db,"scope","reading","compare",json!({"uid":sha,"expected":first,"value":receipt})).is_err());assert_eq!(call(&mut db,"scope","reading","read",json!({"uid":sha})).unwrap(),next);
  db.execute_batch("CREATE TRIGGER fail_reading BEFORE UPDATE ON client_intent_records BEGIN SELECT RAISE(ABORT,'synthetic full'); END").unwrap();assert!(call(&mut db,"scope","reading","compare",json!({"uid":sha,"expected":next,"value":receipt})).is_err());assert_eq!(call(&mut db,"scope","reading","read",json!({"uid":sha})).unwrap(),next);db.execute_batch("DROP TRIGGER fail_reading").unwrap();
  call(&mut db,"scope","reading","clear",json!({})).unwrap();assert!(call(&mut db,"scope","reading","compare",json!({"uid":sha,"expected":null,"value":first})).is_err());let archive=json!({"version":1,"scope":"scope","domain":"reading","rows":[{"kind":"reading","uid":sha,"value":next}]});for _ in 0..2{call(&mut db,"scope","reading","archive",json!({"epoch":1,"uid":"archive","value":archive})).unwrap();}assert!(call(&mut db,"scope","reading","read",json!({"epoch":1,"uid":sha})).unwrap().is_null());assert_eq!(call(&mut db,"scope","reading","rows",json!({"epoch":1})).unwrap().as_array().unwrap().len(),1);
 }
}

//! 原生命令调度：数据库actor的锁等待和结果接收经异步端口进入阻塞线程，避免占住窗口线程。
use crate::{app_core::{AppCore,CoreError,CoreErrorCode,RequestContext},learning_store::{self,Row}};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct LearningRequest{#[serde(flatten)]context:RequestContext,scope:String,action:String,kind:Option<String>,uid:Option<String>,expected:Option<String>,value:Option<String>,#[serde(default)]rows:Vec<Row>,#[serde(default)]fresh:bool}
fn valid_row(kind:&str,uid:&str,value:&str)->bool{
 if !["sessions","operations"].contains(&kind)||uid.is_empty()||uid.len()>256||value.len()>32*1024*1024{return false}
 let Ok(v)=serde_json::from_str::<serde_json::Value>(value)else{return false};
 v.get("uid").and_then(|v|v.as_str())==Some(uid)&&if kind=="sessions"{v.get("revision").and_then(|v|v.as_u64()).is_some_and(|v|v>0)&&v.get("messages").is_some_and(|v|v.is_array())}else{v.is_object()}
}
/// 学习行仓储粗粒度入口；profile由AppCore绑定，scope隔离数据重置世代，不接受前端SQL。
#[tauri::command]
pub async fn native_learning_repository(request:LearningRequest,core:tauri::State<'_,AppCore>)->Result<serde_json::Value,CoreError>{
 let context=request.context;let id=context.request_id.clone();let scope=request.scope;
 let kind=request.kind.unwrap_or_default();let uid=request.uid.unwrap_or_default();
 let invalid=||CoreError::invalid(&id,"学习仓储请求无效");
 if scope.is_empty()||scope.len()>1024||request.rows.len()>20000||request.rows.iter().map(|r|r.value.len()).sum::<usize>()>64*1024*1024||request.rows.iter().any(|r|!valid_row(&r.kind,&r.uid,&r.value)){return Err(invalid())}
 if request.action=="compare"&&(!["sessions","operations"].contains(&kind.as_str())||uid.is_empty()||uid.len()>256||request.value.as_ref().is_some_and(|v|!valid_row(&kind,&uid,v))){return Err(invalid())}
 if request.action=="restore"&&request.rows.iter().any(|r|r.kind!="sessions"){return Err(invalid())}
 core.with_profile_db_async(&context,move|db|{
  let error=|_|CoreError::new(CoreErrorCode::Database,"本机学习数据库操作失败",true,&id);
  learning_store::initialize(db).map_err(error)?;
  let result=match request.action.as_str(){
   "status"=>serde_json::json!(learning_store::ready(db,&scope).map_err(error)?),
   "migrate"=>{learning_store::migrate(db,&scope,&request.rows).map_err(error)?;serde_json::Value::Null},
   "read"=>serde_json::json!(learning_store::read(db,&scope,&kind,&uid).map_err(error)?),
   "list"=>serde_json::json!(learning_store::list_sessions(db,&scope).map_err(error)?),
   "snapshot"=>serde_json::json!(learning_store::snapshot(db,&scope).map_err(error)?),
   "compare"=>{if !learning_store::compare(db,&scope,&kind,&uid,request.expected.as_deref(),request.value.as_deref()).map_err(error)?{return Err(CoreError::new(CoreErrorCode::Conflict,"讨论或保存记录已在其他窗口修改，请重新加载",true,&id))}serde_json::Value::Null},
   "restore"=>serde_json::json!(learning_store::restore(db,&scope,&request.rows,request.fresh).map_err(error)?),
   _=>return Err(CoreError::invalid(&id,"学习仓储操作无效")),
  };Ok(result)
 }).await
}

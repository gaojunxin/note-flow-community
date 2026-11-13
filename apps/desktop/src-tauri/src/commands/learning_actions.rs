//! 原生命令调度：数据库actor的锁等待和结果接收经异步端口进入阻塞线程，避免占住窗口线程。
use crate::{app_core::{AppCore,CoreError,CoreErrorCode,RequestContext},learning_store::{self,Row}};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ActionRequest{#[serde(flatten)]context:RequestContext,scope:String,action:String,kind:Option<String>,uid:Option<String>,expected:Option<String>,value:Option<String>,#[serde(default)]rows:Vec<Row>,#[serde(default)]fresh:bool}
fn valid_row(row:&Row)->bool{
 if !["drafts","operations"].contains(&row.kind.as_str())||row.uid.is_empty()||row.uid.len()>256||row.value.len()>32*1024*1024{return false}
 let Ok(v)=serde_json::from_str::<serde_json::Value>(&row.value)else{return false};v.is_object()&&v.get("uid").and_then(|v|v.as_str())==Some(row.uid.as_str())
}
/// 成果专用入口隔离正式会话命名空间；完整旧行比较同时围住租约身份，不接受前端SQL。
#[tauri::command]
pub async fn native_learning_actions(request:ActionRequest,core:tauri::State<'_,AppCore>)->Result<serde_json::Value,CoreError>{
 let context=request.context;let id=context.request_id.clone();let kind=request.kind.unwrap_or_default();let uid=request.uid.unwrap_or_default();
 if request.scope.is_empty()||request.scope.len()>1024||request.rows.len()>20000||request.rows.iter().map(|r|r.value.len()).sum::<usize>()>64*1024*1024||request.rows.iter().any(|r|!valid_row(r)){return Err(CoreError::invalid(&id,"成果仓储请求无效"))}
 if request.action=="compare"&&request.value.as_ref().is_none_or(|v|!valid_row(&Row{kind:kind.clone(),uid:uid.clone(),value:v.clone()})){return Err(CoreError::invalid(&id,"成果记录格式无效"))}
 if request.action=="restore"&&request.rows.iter().any(|r|r.kind=="operations"&&serde_json::from_str::<serde_json::Value>(&r.value).is_ok_and(|v|v.get("lease").is_some()||v.get("leaseUntil").is_some())){return Err(CoreError::invalid(&id,"恢复不能继承旧执行租约"))}
 let scope=format!("actions:{}",request.scope);
 core.with_profile_db_async(&context,move|db|{
  let error=|_|CoreError::new(CoreErrorCode::Database,"本机成果数据库操作失败",true,&id);learning_store::initialize(db).map_err(error)?;
  Ok(match request.action.as_str(){
   "status"=>serde_json::json!(learning_store::ready(db,&scope).map_err(error)?),
   "migrate"=>{learning_store::migrate(db,&scope,&request.rows).map_err(error)?;serde_json::Value::Null},
   "read"=>serde_json::json!(learning_store::read(db,&scope,&kind,&uid).map_err(error)?),
   "snapshot"=>serde_json::json!(learning_store::snapshot(db,&scope).map_err(error)?),
   "compare"=>{let value=request.value.unwrap();let written=if kind=="drafts"{learning_store::compare_action_draft(db,&scope,&uid,request.expected.as_deref(),&value)}else{learning_store::compare_action_operation(db,&scope,&uid,request.expected.as_deref(),&value)}.map_err(error)?;if !written{return Err(CoreError::new(CoreErrorCode::Conflict,"成果已被其他窗口修改、确认或接管，请重新打开",true,&id))}serde_json::Value::Null},
   "restore"=>{learning_store::restore_action_rows(db,&scope,&request.rows,request.fresh).map_err(error)?;serde_json::Value::Null},
   _=>return Err(CoreError::invalid(&id,"成果仓储操作无效")),
  })
 }).await
}

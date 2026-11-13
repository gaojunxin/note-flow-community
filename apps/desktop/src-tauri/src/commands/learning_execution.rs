//! 原生命令调度：数据库actor的锁等待和结果接收经异步端口进入阻塞线程，避免占住窗口线程。
use crate::{app_core::{AppCore,CoreError,CoreErrorCode,RequestContext},learning_store::{self,Row},learning_execution};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ExecutionRequest{#[serde(flatten)]context:RequestContext,scope:String,action:String,kind:Option<String>,uid:Option<String>,value:Option<String>,expected:Option<u64>,expected_uid:Option<String>,#[serde(default)]rows:Vec<Row>}
fn valid(row:&Row,scope:&str)->bool{
 if !["plans","receipts","archives"].contains(&row.kind.as_str())||row.uid.is_empty()||row.uid.len()>2048||row.value.len()>32*1024*1024{return false}
 let Ok(value)=serde_json::from_str::<serde_json::Value>(&row.value)else{return false};if row.kind=="archives"{return value.is_object()}
 let Some(key)=value.get("key").and_then(|v|v.as_str())else{return false};let Ok(key)=serde_json::from_str::<Vec<String>>(key)else{return false};
 if key.first().map(String::as_str)!=Some(scope){return false}
 if row.kind=="plans"{key.len()==2&&key[1]==row.uid&&value["plan"]["revision"].as_u64().is_some()&&["draft","applying","partial","completed"].iter().any(|s|value["plan"]["status"]==*s)&&value["plan"]["actions"].is_array()}else{key.len()==3&&value["key"].as_str()==Some(row.uid.as_str())&&value["summary"].is_string()&&value["completedAt"].is_string()}
}
/// 原生执行恢复仓储；历史档案只能写archives，不能通过备份接口插入活跃计划或技能回执。
#[tauri::command]
pub async fn native_learning_execution(request:ExecutionRequest,core:tauri::State<'_,AppCore>)->Result<serde_json::Value,CoreError>{
 let context=request.context;let id=context.request_id.clone();let kind=request.kind.unwrap_or_default();let uid=request.uid.unwrap_or_default();
 if request.scope.is_empty()||request.scope.len()>1024||request.rows.len()>20000||request.rows.iter().map(|r|r.value.len()).sum::<usize>()>64*1024*1024||request.rows.iter().any(|r|!valid(r,&request.scope)){return Err(CoreError::invalid(&id,"执行仓储请求无效"))}
 if ["save","insert"].contains(&request.action.as_str())&&request.value.as_ref().is_none_or(|value|!valid(&Row{kind:kind.clone(),uid:uid.clone(),value:value.clone()},&request.scope)){return Err(CoreError::invalid(&id,"执行记录格式无效"))}
 if request.action=="clear"&&request.value.is_some(){return Err(CoreError::invalid(&id,"丢弃请求不能写入新方案"))}
 let scope=format!("execution:{}",request.scope);
 core.with_profile_db_async(&context,move|db|{let error=|_|CoreError::new(CoreErrorCode::Database,"本机执行恢复数据库操作失败",true,&id);learning_store::initialize(db).map_err(error)?;
  Ok(match request.action.as_str(){
   "status"=>serde_json::json!(learning_store::ready(db,&scope).map_err(error)?),
   "migrate"=>{learning_store::migrate(db,&scope,&request.rows).map_err(error)?;serde_json::Value::Null},
   "snapshot"=>serde_json::json!(learning_store::snapshot(db,&scope).map_err(error)?),
   "read"=>serde_json::json!(learning_store::read(db,&scope,&kind,&uid).map_err(error)?),
   "save"|"clear" if kind=="plans"=>{if !learning_execution::save_plan(db,&scope,&uid,request.expected.unwrap_or(u64::MAX),request.value.as_deref(),request.expected_uid.as_deref()).map_err(error)?{return Err(CoreError::new(CoreErrorCode::Conflict,"工作区方案已变化或仍有未确认执行，不能丢弃或覆盖",true,&id))}serde_json::Value::Null},
   "insert" if kind=="receipts"||kind=="archives"=>{learning_execution::insert_once(db,&scope,&kind,&uid,request.value.as_deref().unwrap()).map_err(error)?;serde_json::Value::Null},
   "clearPlans"=>{if !learning_execution::clear_plans(db,&scope).map_err(error)?{return Err(CoreError::new(CoreErrorCode::Conflict,"仍有执行中的方案，不能清理",true,&id))}serde_json::Value::Null},
   _=>return Err(CoreError::invalid(&id,"执行仓储操作无效")),
  })
 }).await
}

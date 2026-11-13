//! 原生命令调度：数据库actor的锁等待和结果接收经异步端口进入阻塞线程，避免占住窗口线程。
use crate::{app_core::{AppCore,CoreError,CoreErrorCode,RequestContext},review_store::{self,Row}};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ReviewRequest{#[serde(flatten)]context:RequestContext,scope:String,kind:String,action:String,uid:Option<String>,group:Option<String>,expected:Option<String>,value:Option<String>,#[serde(default)]rows:Vec<Row>,limit:Option<usize>,#[serde(default)]owner:bool,#[serde(default)]fresh:bool}
/// 历史/草稿粗粒度入口：不接受前端SQL，真实profile连接内执行迁移、比较、追加和裁剪。
#[tauri::command]
pub async fn native_review_repository(request:ReviewRequest,core:tauri::State<'_,AppCore>)->Result<serde_json::Value,CoreError>{
 let context=request.context;let id=context.request_id.clone();let scope=request.scope;let kind=request.kind;
 if scope.is_empty()||scope.len()>1024||!["history","consolidation","series","archives"].contains(&kind.as_str())||request.rows.len()>20000||request.rows.iter().map(|r|r.value.len()).sum::<usize>()>64*1024*1024||request.rows.iter().any(|r|r.uid.is_empty()||r.uid.len()>8192||r.value.len()>32*1024*1024)||request.value.as_ref().is_some_and(|v|v.len()>32*1024*1024)||request.expected.as_ref().is_some_and(|v|v.len()>32*1024*1024)||request.uid.as_ref().is_some_and(|v|v.is_empty()||v.len()>8192){return Err(CoreError::invalid(&id,"历史/草稿请求格式或大小无效"))}
 core.with_profile_db_async(&context,move|db|{
  let error=|_|CoreError::new(CoreErrorCode::Database,"本机历史/草稿操作失败，原始数据已保留",true,&id);
  review_store::initialize(db).map_err(error)?;
  let result=match request.action.as_str(){
   "status"=>serde_json::json!(review_store::ready(db,&scope,&kind).map_err(error)?),
   "migrate"=>{review_store::migrate(db,&scope,&kind,&request.rows).map_err(error)?;serde_json::Value::Null},
   "read"=>serde_json::json!(review_store::read(db,&scope,&kind,request.uid.as_deref().ok_or_else(||CoreError::invalid(&id,"缺少记录标识"))?).map_err(error)?),
   "list"=>serde_json::json!(review_store::list(db,&scope,&kind,request.group.as_deref()).map_err(error)?),
   "append" if kind=="history"&&request.rows.len()==1=>{let limit=request.limit.unwrap_or(50);if limit==0||limit>50{return Err(CoreError::invalid(&id,"历史保留数量无效"))}review_store::append(db,&scope,&request.rows[0],limit).map_err(error)?;serde_json::Value::Null},
   "compare" if ["series","consolidation"].contains(&kind.as_str())=>{if !review_store::compare(db,&scope,&kind,request.uid.as_deref().ok_or_else(||CoreError::invalid(&id,"缺少草稿标识"))?,request.expected.as_deref(),request.value.as_deref()).map_err(error)?{return Err(CoreError::new(CoreErrorCode::Conflict,"草稿已由另一窗口修改，请重新打开",true,&id))}serde_json::Value::Null},
   "restore"=>{review_store::restore(db,&scope,&kind,&request.rows,request.fresh).map_err(error)?;serde_json::Value::Null},
   "clear"=>{review_store::clear(db,&scope,&kind,request.group.as_deref(),request.owner).map_err(error)?;serde_json::Value::Null},
   _=>return Err(CoreError::invalid(&id,"历史/草稿操作无效")),
  };Ok(result)
 }).await
}

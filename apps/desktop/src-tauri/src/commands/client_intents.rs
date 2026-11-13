//! 原生命令调度：数据库actor的锁等待和结果接收经异步端口进入阻塞线程，避免占住窗口线程。
use crate::{app_core::{AppCore,CoreError,CoreErrorCode,RequestContext},client_intents::{self,Request}};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct IntentRequest{#[serde(flatten)]context:RequestContext,#[serde(flatten)]data:Request}
/// 任务关联/阅读意图粗粒度端口，profile由AppCore绑定，前端不传SQL或伪造事务。
#[tauri::command]
pub async fn native_client_intents(request:IntentRequest,core:tauri::State<'_,AppCore>)->Result<serde_json::Value,CoreError>{let context=request.context;let id=context.request_id.clone();let scope=context.profile_id.clone();core.with_profile_db_async(&context,move|db|client_intents::execute(db,&scope,request.data).map_err(|_|CoreError::new(CoreErrorCode::Database,"本机关联或阅读状态提交失败、已变化或超过上限，请重新加载",true,&id))).await}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn accepts_the_flat_typed_client_request(){let value=serde_json::json!({"requestId":"00000000-0000-4000-8000-000000000001","profileId":"synthetic-profile","domain":"reading","action":"compare","epoch":0,"uid":"a".repeat(64),"expected":null,"value":{"page":1}});let request:IntentRequest=serde_json::from_value(value).unwrap();assert_eq!(request.context.profile_id,"synthetic-profile");assert_eq!(request.data.action,"compare");}
}

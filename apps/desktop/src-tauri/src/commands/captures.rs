//! 原生命令调度：数据库actor的锁等待和结果接收经异步端口进入阻塞线程，避免占住窗口线程。
use crate::{
    app_core::{AppCore, CoreError, CoreErrorCode, RequestContext},
    capture_store::{self, Request},
};
use base64::Engine;
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureRequest {
    #[serde(flatten)]
    context: RequestContext,
    #[serde(flatten)]
    data: Request,
}
/// 日志元数据由AppCore所属连接处理，文件根目录仅由原生派生。
#[tauri::command]
pub async fn native_capture_store(
    request: CaptureRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<serde_json::Value, CoreError> {
    let c = request.context;
    let id = c.request_id.clone();
    let root = capture_store::root(core.app_data_root(), &c.profile_id, &request.data.scope);
    core.with_profile_db_async(&c, move |db| {
        capture_store::execute(db, &root, request.data)
            .map_err(|error| CoreError::new(CoreErrorCode::Database, error, true, &id))
    }).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BinaryRequest {
    #[serde(flatten)]
    context: RequestContext,
    scope: String,
    epoch: u64,
    sha256: String,
    action: String,
}
/// 字节走原始IPC体和二进制响应，避免Blob变成JSON数字数组；头部仅包含身份与摘要。
#[tauri::command]
pub async fn native_capture_bytes(
    request: tauri::ipc::Request<'_>,
    core: tauri::State<'_, AppCore>,
) -> Result<tauri::ipc::Response, CoreError> {
    let parse = || -> Option<BinaryRequest> {
        let raw = request
            .headers()
            .get("x-note-flow-capture")?
            .to_str()
            .ok()?;
        if raw.len() > 8192 {
            return None;
        }
        let bytes = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
        serde_json::from_slice(&bytes).ok()
    };
    let r = parse().ok_or_else(|| {
        CoreError::new(CoreErrorCode::InvalidArgument, "附件请求头无效", false, "")
    })?;
    let c = r.context;
    let id = c.request_id.clone();
    let root = capture_store::root(core.app_data_root(), &c.profile_id, &r.scope);
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() <= 64 * 1024 * 1024 => bytes.clone(),
        _ => {
            return Err(CoreError::new(
                CoreErrorCode::InvalidArgument,
                "附件必须通过二进制IPC传输",
                false,
                &id,
            ))
        }
    };
    core.with_profile_db_async(&c, move |db| {
        let result = if r.action == "upload" {
            capture_store::upload(db, &root, &r.scope, r.epoch, &r.sha256, &bytes)
                .map(|_| Vec::new())
        } else if r.action == "read" {
            capture_store::read_checked(db, &root, &r.scope, r.epoch, &r.sha256)
        } else {
            Err("附件操作无效".into())
        };
        result
            .map(tauri::ipc::Response::new)
            .map_err(|error| CoreError::new(CoreErrorCode::Database, error, true, &id))
    }).await
}

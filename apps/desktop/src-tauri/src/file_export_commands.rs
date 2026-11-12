use crate::file_export::{prepare, prepare_bounded, ExportLeases};
/// 在本机选择目标文件并返回属于当前窗口的租约，取消时返回None，路径不跨IPC传递。
/// export_kind仅选择已有导出大小预算，不授予知识等业务能力；调用方须提交或取消租约。
#[tauri::command]
pub async fn choose_file_export(
    window: tauri::WebviewWindow,
    default_name: String,
    export_kind: Option<String>,
    state: tauri::State<'_, ExportLeases>,
) -> Result<Option<String>, String> {
    let max_size = match export_kind.as_deref() {
        None => 64 * 1024 * 1024,
        Some("vault-backup") => 100 * 1024 * 1024,
        Some("knowledge-archive") => 256 * 1024 * 1024,
        _ => return Err("文件导出类型无效".to_string()),
    };
    let (name, _) = prepare(&default_name, "").map_err(|_| "导出名称无效".to_string())?;
    let path = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("保存本地导出")
            .set_file_name(name)
            .save_file()
    })
    .await
    .map_err(|_| "文件选择未完成".to_string())?;
    match path {
        Some(path) => state
            .insert_bounded(window.label(), path, max_size)
            .map(Some)
            .map_err(|_| "未完成导出过多，请稍后重试".to_string()),
        None => Ok(None),
    }
}
/// 消费当前窗口的导出租约并等待本机写入完成；成功不代表远端确认。
/// 内容超限、租约过期或取消均失败，调用方不能据此回退到另一条下载路径。
#[tauri::command]
pub async fn commit_file_export(
    window: tauri::WebviewWindow,
    lease_uid: String,
    content_base64: String,
    state: tauri::State<'_, ExportLeases>,
) -> Result<bool, String> {
    let permit = state
        .claim(window.label(), &lease_uid)
        .map_err(|_| "文件导出授权无效或已过期".to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (_, bytes) = prepare_bounded("export", &content_base64, permit.max_size)
            .map_err(|_| "导出内容无效或超过授权大小".to_string())?;
        permit
            .write(&bytes)
            .map_err(|_| "文件保存未完成或已取消".to_string())?;
        Ok(true)
    })
    .await
    .map_err(|_| "文件保存未完成".to_string());
    let _ = state.cancel(window.label(), &lease_uid);
    result?
}
/// 取消当前窗口持有的租约；不允许借其他窗口的身份取消导出。
#[tauri::command]
pub fn cancel_file_export(
    window: tauri::WebviewWindow,
    lease_uid: String,
    state: tauri::State<'_, ExportLeases>,
) -> Result<(), String> {
    state
        .cancel(window.label(), &lease_uid)
        .map_err(|_| "文件导出授权不属于当前窗口".to_string())
}

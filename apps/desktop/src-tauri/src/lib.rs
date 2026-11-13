pub mod ai_client;
pub(crate) mod attachment_diagnostics;
pub mod community;
mod file_export;
mod file_export_commands;
mod profile_media;
pub mod capture_store;
mod resource_policy;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub mod app_core;
mod canvas;
mod commands;
pub mod db;
mod notes;
mod local_state;
mod learning_store;
mod review_store;
pub mod client_intents;
mod learning_execution;
mod search;
pub(crate) use note_flow_local_core::search as search_normalization;
mod native_startup;
mod startup;
mod tasks;
mod task_reminder_activation;
mod task_reminder_target;
mod workspace;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultFile {
    relative_path: String,
    name: String,
    last_modified: u64,
    bytes: Vec<u8>,
}
struct VaultState(Mutex<Option<PathBuf>>);
fn collect_vault_files(
    root: &std::path::Path,
    current: &std::path::Path,
    values: &mut Vec<VaultFile>,
) -> Result<(), String> {
    collect_vault_files_with_progress(root, current, values, None)
}
fn collect_vault_files_with_progress(
    root: &std::path::Path,
    current: &std::path::Path,
    values: &mut Vec<VaultFile>,
    progress: Option<&dyn Fn(usize)>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_vault_files_with_progress(root, &path, values, progress)?
        } else if path.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let name = path
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("file")
                .to_string();
            let last_modified = entry
                .metadata()
                .ok()
                .and_then(|v| v.modified().ok())
                .and_then(|v| v.duration_since(UNIX_EPOCH).ok())
                .map(|v| v.as_millis() as u64)
                .unwrap_or(0);
            let lower_name = name.to_ascii_lowercase();
            let bytes = if lower_name.ends_with(".md") || lower_name.ends_with(".excalidraw") {
                fs::read(&path).map_err(|e| e.to_string())?
            } else {
                Vec::new()
            };
            values.push(VaultFile {
                relative_path: format!(
                    "{}/{}",
                    root.file_name()
                        .and_then(|v| v.to_str())
                        .unwrap_or("Obsidian Vault"),
                    relative
                ),
                name,
                last_modified,
                bytes,
            });
            if let Some(report) = progress {
                if values.len() % 50 == 0 {
                    report(values.len());
                }
            }
        }
    }
    Ok(())
}
#[tauri::command]
fn choose_obsidian_vault(
    state: tauri::State<'_, VaultState>,
) -> Result<Option<Vec<VaultFile>>, String> {
    let Some(root) = rfd::FileDialog::new()
        .set_title("选择 Obsidian Vault")
        .pick_folder()
    else {
        return Ok(None);
    };
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut values = Vec::new();
    collect_vault_files(&root, &root, &mut values)?;
    *state.0.lock().map_err(|_| "Vault 状态锁定失败")? = Some(root);
    Ok(Some(values))
}
/// 只读取用户本次选择的目录；拒绝链接并在读取时限制总字节，避免越界及无限递归。
fn collect_knowledge_folder(root: &std::path::Path, current: &std::path::Path, depth: usize, values: &mut Vec<VaultFile>, total: &mut usize) -> Result<(), String> {
    if depth > 90 { return Err("知识目录层级最多90层".into()); }
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() { return Err("知识目录不支持符号链接，请选择实际文件".into()); }
        let path = entry.path();
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.starts_with(root) { return Err("文件路径超出所选目录".into()); }
        if kind.is_dir() { collect_knowledge_folder(root, &canonical, depth + 1, values, total)?; }
        else if kind.is_file() {
            if values.len() >= 10000 { return Err("文件夹最多支持10000项，请分批导入".into()); }
            let remaining = 256 * 1024 * 1024 - *total;
            let mut bytes = Vec::new();
            use std::io::Read;
            fs::File::open(&canonical).map_err(|e| e.to_string())?.take(remaining as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            if bytes.len() > remaining { return Err("知识文件夹最大支持256 MiB，请分批导入".into()); }
            *total += bytes.len();
            let relative = path.strip_prefix(root).map_err(|e| e.to_string())?.to_str().ok_or("文件路径不是有效UTF-8")?.replace('\\', "/");
            values.push(VaultFile { relative_path: format!("knowledge-import/{}", relative), name: entry.file_name().to_string_lossy().into_owned(), last_modified: 0, bytes });
        }
    }
    Ok(())
}
#[cfg(test)]
mod knowledge_folder_tests {
    use super::*;
    #[test]
    fn native_folder_preserves_nested_bytes_and_enforces_budget() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("主题")).unwrap();
        fs::write(dir.path().join("主题/正文.md"), b"# synthetic").unwrap();
        fs::write(dir.path().join("image.png"), [1, 2, 3]).unwrap();
        let root = dir.path().canonicalize().unwrap();
        let mut files = Vec::new();
        let mut total = 0;
        collect_knowledge_folder(&root, &root, 0, &mut files, &mut total).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(total, 14);
        assert!(files.iter().any(|file| file.relative_path == "knowledge-import/主题/正文.md" && file.bytes == b"# synthetic"));
        assert!(collect_knowledge_folder(&root, &root, 0, &mut Vec::new(), &mut (256 * 1024 * 1024)).is_err());
        assert!(collect_knowledge_folder(&root, &root, 91, &mut Vec::new(), &mut 0).is_err());
    }
}
/// 文件选择只返回本次授权文件内容；多选总量与目录导入保持相同上限。
#[tauri::command]
async fn choose_native_import_files(multiple: bool, extensions: Vec<String>) -> Result<Option<Vec<VaultFile>>, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_title("选择文件");
    if !extensions.is_empty() { dialog = dialog.add_filter("支持的文件", &extensions); }
    let selected = if multiple { dialog.pick_files().await } else { dialog.pick_file().await.map(|file| vec![file]) };
    let Some(selected) = selected else { return Ok(None); };
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        if selected.len() > 10000 { return Err("最多选择10000个文件".into()); }
        let mut total = 0usize;
        let mut result = Vec::new();
        for selected in selected {
            let path = selected.path();
            let mut bytes = Vec::new();
            let remaining = 256 * 1024 * 1024 - total;
            fs::File::open(path).map_err(|e| e.to_string())?.take(remaining as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            if bytes.len() > remaining { return Err("选择文件合计最大支持256 MiB".into()); }
            total += bytes.len();
            result.push(VaultFile { relative_path: String::new(), name: selected.file_name(), last_modified: 0, bytes });
        }
        Ok(Some(result))
    }).await.map_err(|e| e.to_string())?
}
/// 原生目录选择取消返回None；成功返回有界文件内容，不保存或暴露可复用的磁盘读取授权。
#[tauri::command]
async fn choose_knowledge_import_folder() -> Result<Option<Vec<VaultFile>>, String> {
    let Some(root) = rfd::AsyncFileDialog::new().set_title("选择要导入的知识文件夹").pick_folder().await else { return Ok(None); };
    let root = root.path().canonicalize().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut values = Vec::new();
        collect_knowledge_folder(&root, &root, 0, &mut values, &mut 0)?;
        Ok(Some(values))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn choose_file_import_folder(
    state: tauri::State<'_, VaultState>,
    on_progress: tauri::ipc::Channel<usize>,
) -> Result<Option<Vec<VaultFile>>, String> {
    let Some(root) = rfd::FileDialog::new()
        .set_title("选择要导入的文件夹")
        .pick_folder()
    else {
        return Ok(None);
    };
    // Confirmation starts scanning; the picker itself must not open an app panel.
    let _ = on_progress.send(0);
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut values = Vec::new();
    let report = |count| {
        let _ = on_progress.send(count);
    };
    collect_vault_files_with_progress(&root, &root, &mut values, Some(&report))?;
    report(values.len());
    *state.0.lock().map_err(|_| "文件夹导入状态锁定失败")? = Some(root);
    Ok(Some(values))
}
#[tauri::command]
async fn read_obsidian_vault_file(
    relative_path: String,
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<u8>, String> {
    let guard = state.0.lock().map_err(|_| "Vault 状态锁定失败")?;
    let root = guard.as_ref().ok_or("请重新选择 Vault")?;
    let mut parts = relative_path.split('/');
    parts.next();
    let target = parts
        .fold(root.clone(), |path, part| path.join(part))
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !target.starts_with(root) {
        return Err("附件路径超出所选 Vault".into());
    }
    fs::read(target).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_import_file(
    relative_path: String,
    state: tauri::State<'_, VaultState>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = read_obsidian_vault_file(relative_path, state).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn save_vault_import_template(bytes: Vec<u8>) -> Result<Option<String>, String> {
    if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
        return Err("Excel 模板内容无效".into());
    }
    let Some(target) = rfd::FileDialog::new()
        .set_title("保存迹语保险箱导入模板")
        .set_file_name("迹语保险箱导入模板.xlsx")
        .add_filter("Excel 工作簿", &["xlsx"])
        .save_file()
    else {
        return Ok(None);
    };
    file_export::write_atomic(&target, &bytes).map_err(|e| format!("模板保存失败：{e}"))?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
fn save_vault_backup(bytes: Vec<u8>, default_name: String) -> Result<Option<String>, String> {
    if bytes.is_empty() || bytes.len() > 100 * 1024 * 1024 {
        return Err("保险箱备份内容无效".into());
    }
    let file_name = if default_name.ends_with(".json")
        && !default_name.contains('/')
        && !default_name.contains('\\')
        && default_name.len() <= 200
    {
        default_name
    } else {
        "迹语保险箱备份.json".into()
    };
    let Some(target) = rfd::FileDialog::new()
        .set_title("保存迹语保险箱加密备份")
        .set_file_name(&file_name)
        .add_filter("JSON 加密备份", &["json"])
        .save_file()
    else {
        return Ok(None);
    };
    file_export::write_atomic(&target, &bytes).map_err(|e| format!("备份保存失败：{e}"))?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
fn save_edition_transfer(
    content_base64: String,
    default_name: String,
) -> Result<Option<String>, String> {
    if content_base64.len() > 4 * ((64 * 1024 * 1024 + 2) / 3) {
        return Err("版本切换档案内容无效".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|_| "版本切换档案编码无效".to_string())?;
    if bytes.is_empty() || bytes.len() > 64 * 1024 * 1024 {
        return Err("版本切换档案内容无效".into());
    }
    let file_name = if default_name.ends_with(".json")
        && !default_name.contains('/')
        && !default_name.contains('\\')
        && default_name.len() <= 200
    {
        default_name
    } else {
        "NoteFlow-edition-transfer.json".into()
    };
    let Some(target) = rfd::FileDialog::new()
        .set_title("保存版本切换档案")
        .set_file_name(&file_name)
        .add_filter("JSON 档案", &["json"])
        .save_file()
    else {
        return Ok(None);
    };
    file_export::write_atomic(&target, &bytes).map_err(|e| format!("备份保存失败：{e}"))?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[tauri::command]
fn save_local_export(content_base64: String, default_name: String) -> Result<bool, String> {
    if content_base64.len() > 4 * ((64 * 1024 * 1024 + 2) / 3) {
        return Err("本地导出最大支持 64 MiB".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|_| "导出文件编码无效".to_string())?;
    if bytes.is_empty()
        || bytes.len() > 64 * 1024 * 1024
        || default_name.contains('/')
        || default_name.contains('\\')
        || default_name.len() > 200
        || !(default_name.ends_with(".json") || default_name.ends_with(".zip"))
    {
        return Err("导出文件无效".into());
    }
    let Some(target) = rfd::FileDialog::new()
        .set_title("保存本地导出")
        .set_file_name(&default_name)
        .save_file()
    else {
        return Ok(false);
    };
    file_export::write_atomic(&target, &bytes).map_err(|error| format!("文件保存失败：{error}"))?;
    Ok(true)
}

fn safe_segment(value: &str) -> Result<String, String> {
    let safe: String = value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(100)
        .collect();
    if safe.is_empty() {
        Err("无效的本地存储标识".into())
    } else {
        Ok(safe)
    }
}
fn media_root(app: &tauri::AppHandle, storage_key: &str, kind: &str) -> Result<PathBuf, String> {
    let storage = safe_segment(storage_key)?;
    let folder = match kind {
        "attachments" => "attachments",
        "recordings" => "recordings",
        _ => return Err("不支持的媒体类型".into()),
    };
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("profiles")
        .join(storage)
        .join(folder);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}
#[tauri::command]
fn legacy_database_exists(app: tauri::AppHandle, owner: String) -> Result<bool, String> {
    let owner = safe_segment(&owner)?;
    // Match the SQL plugin's directory on Windows, Linux and macOS.
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(format!("note-flow-v2-{owner}.db"));
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.is_file()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
async fn save_profile_media(
    app: tauri::AppHandle,
    storage_key: String,
    kind: String,
    file_name: String,
    sha256: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let root = media_root(&app, &storage_key, &kind)?;
    let name = profile_media::save_verified(&root, &file_name, &sha256, &bytes)?;
    Ok(format!("{kind}/{name}"))
}
#[tauri::command]
async fn read_profile_media(
    app: tauri::AppHandle,
    storage_key: String,
    relative_path: String,
) -> Result<Vec<u8>, String> {
    let mut parts = relative_path.split('/');
    let kind = parts.next().ok_or("无效媒体路径")?;
    let name = parts.next().ok_or("无效媒体路径")?;
    if parts.next().is_some() || name.contains("..") || name.contains('\\') {
        return Err("无效媒体路径".into());
    }
    fs::read(media_root(&app, &storage_key, kind)?.join(name)).map_err(|e| e.to_string())
}
// Public binary file boundary: keep legacy callers intact while new integrations
// avoid the allocation overhead of JSON-encoded Vec<u8> IPC.
#[tauri::command]
async fn save_profile_media_base64(
    app: tauri::AppHandle,
    storage_key: String,
    kind: String,
    file_name: String,
    sha256: String,
    content_base64: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|_| "媒体编码无效".to_string())?;
    save_profile_media(app, storage_key, kind, file_name, sha256, bytes).await
}
#[tauri::command]
async fn read_profile_media_base64(
    app: tauri::AppHandle,
    storage_key: String,
    relative_path: String,
) -> Result<String, String> {
    let bytes = read_profile_media(app, storage_key, relative_path).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}
#[tauri::command]
fn delete_profile_media(
    app: tauri::AppHandle,
    storage_key: String,
    relative_path: String,
) -> Result<(), String> {
    let mut parts = relative_path.split('/');
    let kind = parts.next().ok_or("无效媒体路径")?;
    let name = parts.next().ok_or("无效媒体路径")?;
    if parts.next().is_some() || name.contains("..") || name.contains('\\') {
        return Err("无效媒体路径".into());
    }
    let target = media_root(&app, &storage_key, kind)?.join(name);
    if target.exists() {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn checked_profile_media(
    app: &tauri::AppHandle,
    storage_key: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "LOCAL_STORAGE_UNAVAILABLE")?
        .join("profiles")
        .join(safe_segment(storage_key)?);
    attachment_diagnostics::media_path(&root, relative_path)
}
#[tauri::command]
fn profile_media_size(
    app: tauri::AppHandle,
    storage_key: String,
    relative_path: String,
) -> Result<Option<u64>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "LOCAL_STORAGE_UNAVAILABLE")?
        .join("profiles")
        .join(safe_segment(&storage_key)?);
    attachment_diagnostics::media_size(&root, &relative_path)
}
#[tauri::command]
async fn open_profile_media_file(
    app: tauri::AppHandle,
    storage_key: String,
    relative_path: String,
) -> Result<String, String> {
    let target = checked_profile_media(&app, &storage_key, &relative_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        attachment_diagnostics::open_target(&target, false)
    })
    .await
    .map_err(|_| "SYSTEM_OPENER_START_FAILED".to_string())?
}
#[tauri::command]
async fn reveal_profile_media_file(
    app: tauri::AppHandle,
    storage_key: String,
    relative_path: String,
) -> Result<String, String> {
    let target = checked_profile_media(&app, &storage_key, &relative_path)?;
    tauri::async_runtime::spawn_blocking(move || attachment_diagnostics::open_target(&target, true))
        .await
        .map_err(|_| "SYSTEM_OPENER_START_FAILED".to_string())?
}

#[tauri::command]
fn save_performance_report(app: tauri::AppHandle, report: String) -> Result<String, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("performance");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let target = directory.join("m19-baseline-latest.json");
    let temporary = directory.join("m19-baseline-latest.json.tmp");
    fs::write(&temporary, report).map_err(|e| e.to_string())?;
    if target.exists() {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderEntry {
    key: String,
    owner_id: String,
    task_uid: String,
    title: String,
    body: String,
    fire_at_ms: i64,
    #[serde(default)]
    fired: bool,
}
struct ReminderState {
    entries: Arc<Mutex<HashMap<String, ReminderEntry>>>,
    path: PathBuf,
}

fn persist(state: &ReminderState) -> Result<(), String> {
    let values: Vec<_> = state
        .entries
        .lock()
        .map_err(|_| "提醒状态锁定失败")?
        .values()
        .cloned()
        .collect();
    let temporary = state.path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(&values).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, &state.path).map_err(|e| e.to_string())
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[tauri::command]
fn replace_task_reminders(
    owner_id: String,
    reminders: Vec<ReminderEntry>,
    state: tauri::State<'_, ReminderState>,
) -> Result<(), String> {
    let mut entries = state.entries.lock().map_err(|_| "提醒状态锁定失败")?;
    let previous = entries.clone();
    entries.retain(|_, v| v.owner_id != owner_id);
    let now = now_ms();
    for mut value in reminders {
        value.owner_id = owner_id.clone();
        if let Some(old) = previous.get(&value.key) {
            value.fired = old.fired
        } else if value.fire_at_ms <= now {
            value.fired = true
        }
        entries.insert(value.key.clone(), value);
    }
    drop(entries);
    persist(&state)
}

fn start_scheduler(
    app: tauri::AppHandle,
    entries: Arc<Mutex<HashMap<String, ReminderEntry>>>,
    path: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            let now = now_ms();
            let mut due = Vec::new();
            if let Ok(mut values) = entries.lock() {
                for value in values.values_mut() {
                    if !value.fired && value.fire_at_ms <= now {
                        value.fired = true;
                        if now - value.fire_at_ms <= 86_400_000 {
                            due.push(value.clone())
                        }
                    }
                }
            }
            if due.is_empty() {
                continue;
            }
            for value in &due {
                #[cfg(target_os = "windows")]
                {
                    // 系统通知注册/发送会等待PowerShell进程，不占用异步调度线程。
                    let notification_app=app.clone();let notification=value.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        if let Err(error)=task_reminder_activation::show(&notification_app,&notification.owner_id,&notification.task_uid,&notification.title,&notification.body) {
                            let _=notification_app.emit("note-flow-reminder-delivery-error",error);
                        }
                    });
                }
                #[cfg(not(target_os = "windows"))]
                let _ = app
                    .notification()
                    .builder()
                    .title(&value.title)
                    .body(&value.body)
                    .show();
                let _ = app.emit("note-flow-reminder-fired", value);
            }
            let state = ReminderState {
                entries: entries.clone(),
                path: path.clone(),
            };
            let _ = persist(&state);
        }
    });
}

fn bypass_proxy_for_private_networks() {
    const PRIVATE_NETWORKS: &str =
        "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";
    let existing = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();
    let value = if existing.trim().is_empty() {
        PRIVATE_NETWORKS.to_string()
    } else {
        format!("{existing},{PRIVATE_NETWORKS}")
    };
    std::env::set_var("NO_PROXY", &value);
    std::env::set_var("no_proxy", value);
}

pub fn run_official(
    context: tauri::Context<tauri::Wry>,
    private_handler: impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static,
) {
    let process_started = std::time::Instant::now();
    bypass_proxy_for_private_networks();
    let local_handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            file_export_commands::choose_file_export,
            file_export_commands::commit_file_export,
            file_export_commands::cancel_file_export,
            ai_client::ai_store_key,
            ai_client::ai_direct_completion,
            ai_client::ai_stream_completion,
            ai_client::ai_cancel_completion,
            db::local_transaction::local_sql_transaction,
            legacy_database_exists,
            replace_task_reminders,
            task_reminder_activation::take_task_reminder_activation,
            save_local_export,
            save_profile_media,
            read_profile_media,
            save_profile_media_base64,
            read_profile_media_base64,
            delete_profile_media,
            profile_media_size,
            open_profile_media_file,
            reveal_profile_media_file,
            attachment_diagnostics::attachment_system_probe,
            choose_obsidian_vault,
            choose_file_import_folder,
            choose_knowledge_import_folder,
            choose_native_import_files,
            read_obsidian_vault_file,
            read_import_file,
            save_vault_import_template,
            save_vault_backup,
            save_edition_transfer,
            save_performance_report,
            startup::frontend_ready,
            commands::core::core_profile_open,
            commands::core::core_profile_close,
            commands::core::core_job_submit_probe,
            commands::core::core_job_cancel,
            commands::core::core_job_status,
            commands::core::core_metrics_snapshot,
            commands::native::native_notes_list,
            commands::native::native_notes_get,
            commands::native::native_notes_search,
            commands::learning::native_learning_repository,
            commands::review::native_review_repository,
            commands::client_intents::native_client_intents,
            commands::captures::native_capture_store,
            commands::captures::native_capture_bytes,
            commands::learning_actions::native_learning_actions,
            commands::learning_execution::native_learning_execution,
            commands::native::native_business_state_read,
            commands::native::native_business_state_list,
            commands::native::native_business_state_write,
            commands::native::native_tasks_list,
            commands::native::native_workspace_list_areas,
            commands::native::native_workspace_list_projects,
            commands::native::native_search,
            commands::native::native_canvases_list,
            commands::native::native_canvas_create,
            commands::native::native_canvases_create_batch,
            commands::native::native_canvas_update,
            commands::native::native_canvas_delete,
            commands::native::native_canvas_snapshots,
            commands::native::native_canvas_restore,
        ]);
    tauri::Builder::default()
        .manage(file_export::ExportLeases::default())
        .manage(task_reminder_activation::Pending::default())
        .plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            task_reminder_activation::accept(app, arguments);
            native_startup::present(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(VaultState(Mutex::new(None)))
        .manage(db::local_transaction::LocalTransactions::default())
        .invoke_handler(move |invoke| {
            if matches!(
                invoke.message.command(),
                "native_knowledge_cache"
                    | "native_knowledge_graph"
                    | "core_sync_component_capabilities"
                    | "native_sync_http"
                    | "native_sync_http_cancel"
                    | "native_sync_claim_operations"
                    | "native_sync_ack_workspace"
                    | "native_sync_stage_page"
                    | "native_sync_pending_pages"
                    | "native_sync_complete_page"
                    | "native_sync_complete_observed_page"
                    | "native_sync_host_area_page"
                    | "native_sync_page_recovery"
                    | "native_note_fallback"
                    | "native_knowledge_import_store"
                    | "native_knowledge_import_bytes"
                    | "native_client_task_notes"
                    | "native_sync_run_flow"
                    | "native_sync_auth_request_flow"
                    | "native_sync_snapshot_flow"
                    | "native_sync_entity_ack"
                    | "native_sync_entity_conflict"
                    | "native_sync_note_content"
                    | "native_sync_epoch_plan"
                    | "native_sync_batch_plan"
                    | "native_sync_cursor_plan"
                    | "native_sync_push_outcomes_plan"
            ) {
                private_handler(invoke)
            } else {
                local_handler(invoke)
            }
        })
        .setup(move |app| {
            let directory = app.path().app_data_dir()?;
            fs::create_dir_all(&directory)?;
            app.manage(startup::StartupTimeline::new(
                directory.join("performance").join("startup-latest.json"),
                process_started,
            ));
            let timeline = app.state::<startup::StartupTimeline>();
            timeline.mark("setup-start");
            native_startup::begin(app.handle())?;
            timeline.mark("native-startup-shown");
            app.manage(app_core::AppCore::with_database_root(directory.clone(),app.path().app_config_dir()?,32));
            timeline.mark("app-core-ready");
            let path = directory.join("task-reminders-v1.json");
            let values: Vec<ReminderEntry> = fs::read(&path)
                .ok()
                .and_then(|v| serde_json::from_slice(&v).ok())
                .unwrap_or_default();
            let entries = Arc::new(Mutex::new(
                values.into_iter().map(|v| (v.key.clone(), v)).collect(),
            ));
            app.manage(ReminderState {
                entries: entries.clone(),
                path: path.clone(),
            });
            start_scheduler(app.handle().clone(), entries, path);
            timeline.mark("background-services-ready");
            // Do not rely only on the executable resource icon. Directly launched
            // Windows builds can otherwise show a blank taskbar button even while
            // the tray icon resolves correctly.
            if let (Some(window), Some(icon)) = (
                app.get_webview_window("main"),
                app.default_window_icon().cloned(),
            ) {
                window.set_skip_taskbar(false)?;
                window.set_icon(icon)?;
            }
            let open = MenuItem::with_id(app, "open", "打开迹语", true, None::<&str>)?;
            let new_note = MenuItem::with_id(app, "new_note", "新建笔记", true, None::<&str>)?;
            let new_task = MenuItem::with_id(app, "new_task", "新建任务", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出迹语", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&open, &new_note, &new_task, &settings, &separator, &quit],
            )?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("迹语 · 后台运行中")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                        return;
                    }
                    native_startup::present(app);
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                        match event.id.as_ref() {
                            "new_note" => {
                                let _ = w.emit("note-flow-tray-navigate", "/notes?create=1");
                            }
                            "new_task" => {
                                let _ = w.emit("note-flow-tray-navigate", "/tasks?create=1");
                            }
                            "settings" => {
                                let _ = w.emit("note-flow-tray-navigate", "/settings");
                            }
                            _ => {}
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        native_startup::present(tray.app_handle());
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            task_reminder_activation::accept(app.handle(), std::env::args());
            timeline.mark("setup-ready");
            startup::start_timeout_guard(app.handle().clone());
            if std::env::args().any(|v| v == "--hidden") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = window
                    .state::<file_export::ExportLeases>()
                    .cancel_owner(window.label());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == native_startup::LABEL {
                    window.app_handle().exit(0);
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        // Keep the desktop binary's embedded frontend synchronized with production builds.
        .build(context)
        .expect("error while building Note Flow")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                if let Err(_error) = native_startup::create_main(app) {
                    native_startup::message(app, "主界面启动失败，请关闭后重试");
                } else {
                    app.state::<startup::StartupTimeline>()
                        .mark("webview-created");
                }
            }
        });
}

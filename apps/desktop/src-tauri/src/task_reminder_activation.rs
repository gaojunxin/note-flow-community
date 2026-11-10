//! 系统提醒激活先排队，由就绪前端消费；冷启动事件不可作为唯一传递途径。
use crate::task_reminder_target::{parse, Target};
#[cfg(target_os = "windows")]
use crate::task_reminder_target::{scheme, xml};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct Pending(Mutex<Option<Target>>);
pub fn accept(app: &tauri::AppHandle, arguments: impl IntoIterator<Item = String>) {
    if let Some(target) = arguments
        .into_iter()
        .find_map(|value| parse(&app.config().identifier, &value))
    {
        // 前端可能仍在冷启动。事件仅作唤醒通知，目标保留到显式读取，避免启动事件丢失。
        let state = app.state::<Pending>();
        if let Ok(mut pending) = state.0.lock() {
            *pending = Some(target);
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
        }
        crate::native_startup::present(app);
        let _ = app.emit("note-flow-reminder-activated", ());
    }
}
#[tauri::command]
pub fn take_task_reminder_activation(
    state: tauri::State<'_, Pending>,
) -> Result<Option<Target>, String> {
    state
        .0
        .lock()
        .map(|mut value| value.take())
        .map_err(|_| "任务提醒状态读取失败".into())
}
#[cfg(target_os = "windows")]
pub fn show(
    app: &tauri::AppHandle,
    owner_id: &str,
    task_uid: &str,
    title: &str,
    body: &str,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let identifier = &app.config().identifier;
    let target = Target {
        owner_id: owner_id.into(),
        task_uid: task_uid.into(),
    };
    let content = xml(identifier, &target, title, body)?;
    let executable = std::env::current_exe().map_err(|_| "客户端路径读取失败")?;
    let shell =
        std::path::PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows目录读取失败")?)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let output = std::process::Command::new(shell)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            include_str!("windows_task_toast.ps1"),
        ])
        .env("NOTEFLOW_TOAST_APP_ID", identifier)
        .env("NOTEFLOW_TOAST_SCHEME", scheme(identifier))
        .env("NOTEFLOW_TOAST_EXECUTABLE", executable)
        .env("NOTEFLOW_TOAST_XML", content)
        .creation_flags(0x08000000)
        .output()
        .map_err(|_| "Windows任务提醒发送失败")?;
    if !output.status.success() {
        return Err("Windows任务提醒激活注册或发送失败".into());
    }
    Ok(())
}

use crate::{file_export, file_export_commands, resource_policy};
use note_flow_local_core::{LocalRequest, LocalStore};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

struct Storage(Arc<Mutex<LocalStore>>);
#[tauri::command]
fn community_reminder_permission(
    app: tauri::AppHandle,
    request: bool,
) -> Result<&'static str, RequestError> {
    let state = if request {
        app.notification().request_permission()
    } else {
        app.notification().permission_state()
    }
    .map_err(|_| RequestError {
        code: "STORAGE_ERROR",
    })?;
    Ok(match state {
        tauri_plugin_notification::PermissionState::Granted => "granted",
        tauri_plugin_notification::PermissionState::Denied => "denied",
        _ => "prompt",
    })
}
#[tauri::command]
fn community_show_reminder(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), RequestError> {
    if title.chars().count() > 200 || body.chars().count() > 2000 {
        return Err(RequestError {
            code: "INVALID_CHANGE",
        });
    }
    if app
        .notification()
        .permission_state()
        .map_err(|_| RequestError {
            code: "STORAGE_ERROR",
        })?
        != tauri_plugin_notification::PermissionState::Granted
    {
        return Err(RequestError {
            code: "CAPABILITY_UNAVAILABLE",
        });
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|_| RequestError {
            code: "STORAGE_ERROR",
        })
}
#[derive(Serialize)]
struct RequestError {
    code: &'static str,
}

#[tauri::command]
async fn community_local_request(
    input: LocalRequest,
    storage: tauri::State<'_, Storage>,
) -> Result<serde_json::Value, RequestError> {
    let store = storage.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = store.lock().map_err(|_| RequestError {
            code: "STORAGE_ERROR",
        })?;
        store
            .request(input)
            .map_err(|error| RequestError { code: error.code() })
    })
    .await
    .map_err(|_| RequestError {
        code: "STORAGE_ERROR",
    })?
}
#[tauri::command]
fn community_close_confirmed(window: tauri::WebviewWindow) -> Result<(), RequestError> {
    window.destroy().map_err(|_| RequestError {
        code: "STORAGE_ERROR",
    })
}
#[tauri::command]
async fn community_save_file(name: String, base64: String) -> Result<bool, RequestError> {
    let (name, bytes) = file_export::prepare(&name, &base64).map_err(|_| RequestError {
        code: "INVALID_CHANGE",
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("导出迹语文件")
            .set_file_name(name)
            .save_file()
        else {
            return Ok(false);
        };
        file_export::write_atomic(&path, &bytes).map_err(|_| RequestError {
            code: "STORAGE_ERROR",
        })?;
        Ok(true)
    })
    .await
    .map_err(|_| RequestError {
        code: "STORAGE_ERROR",
    })?
}
pub fn run(context: tauri::Context<tauri::Wry>) {
    tauri::Builder::default().manage(file_export::ExportLeases::default())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // This identifier resolves to community-only app data. No UI-selected path or SQL.
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let store = LocalStore::open(directory.join("community-workspace-v1.sqlite"))
                .map_err(|_| std::io::Error::other("Community local storage cannot be opened"))?;
            app.manage(Storage(Arc::new(Mutex::new(store))));
            // 主实体仍由LocalStore持有；历史/草稿/恢复资料使用公共AppCore仓储，不导入官方同步装配。
            // 两类表不互相写入：旧IDB辅助资料只按各自迁移标记进入当前community profile。
            app.manage(crate::app_core::AppCore::with_database_root(
                directory.clone(), app.path().app_config_dir()?, 32,
            ));
            app.manage(crate::startup::StartupTimeline::new(
                directory.join("startup-latest.json"), std::time::Instant::now(),
            ));
            let config = &app.config().app.windows[0];
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_web_resource_request(|request, response| {
                    if let Some(policy) = resource_policy::offline_editor_csp(request.uri().path())
                    {
                        response.headers_mut().insert(
                            "Content-Security-Policy",
                            policy.parse().expect("Static offline editor CSP"),
                        );
                    }
                })
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = window.state::<file_export::ExportLeases>().cancel_owner(window.label());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("note-flow-community-close", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            file_export_commands::choose_file_export,
            file_export_commands::commit_file_export,
            file_export_commands::cancel_file_export,
            crate::ai_client::ai_store_key,
            crate::ai_client::ai_direct_completion,
            crate::attachment_diagnostics::attachment_system_probe,
            crate::choose_native_import_files,
            crate::choose_knowledge_import_folder,
            community_local_request,
            crate::commands::core::core_profile_open,
            crate::commands::core::core_profile_close,
            crate::commands::core::core_metrics_snapshot,
            crate::commands::native::native_business_state_read,
            crate::commands::native::native_business_state_list,
            crate::commands::native::native_business_state_write,
            crate::commands::review::native_review_repository,
            crate::commands::learning::native_learning_repository,
            crate::commands::learning_actions::native_learning_actions,
            crate::commands::learning_execution::native_learning_execution,
            crate::commands::client_intents::native_client_intents,
            crate::commands::captures::native_capture_store,
            crate::commands::captures::native_capture_bytes,
            community_close_confirmed,
            community_save_file,
            community_reminder_permission,
            community_show_reminder
        ])
        .run(context)
        .expect("Cannot start community desktop");
}

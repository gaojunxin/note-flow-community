//! profile打开、关闭与状态检查可能等待锁或文件IO，统一交给后台阻塞线程执行。
use crate::app_core::{
    AppCore, CoreError, CoreMetrics, JobProgress, ProfileStatus, RequestContext,
};
use crate::startup::StartupTimeline;
use serde::Deserialize;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoreRequest {
    #[serde(flatten)]
    context: RequestContext,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitProbeRequest {
    #[serde(flatten)]
    context: RequestContext,
    steps: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobRequest {
    #[serde(flatten)]
    context: RequestContext,
    job_id: String,
}

#[tauri::command]
pub async fn core_profile_open(
    request: CoreRequest,
    core: tauri::State<'_, AppCore>,
    app: tauri::AppHandle,
) -> Result<ProfileStatus, CoreError> {
    let core = core.inner().clone();
    crate::app_core::run_blocking_command(request.context.request_id.clone(), move || {
        let result = core.open_profile(&request.context);
        if result.is_ok() { app.state::<StartupTimeline>().mark("profile-ready"); }
        result
    }).await
}

#[tauri::command]
pub async fn core_profile_close(
    request: CoreRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<ProfileStatus, CoreError> {
    let core = core.inner().clone();
    crate::app_core::run_blocking_command(request.context.request_id.clone(), move || core.close_profile(&request.context)).await
}

#[tauri::command]
pub async fn core_job_submit_probe(
    request: SubmitProbeRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<JobProgress, CoreError> {
    let core = core.inner().clone();
    crate::app_core::run_blocking_command(request.context.request_id.clone(), move || core.submit_probe(&request.context, request.steps)).await
}

#[tauri::command]
pub async fn core_job_cancel(
    request: JobRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<JobProgress, CoreError> {
    let core = core.inner().clone();
    crate::app_core::run_blocking_command(request.context.request_id.clone(), move || core.cancel_job(&request.context, &request.job_id)).await
}

#[tauri::command]
pub async fn core_job_status(
    request: JobRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<JobProgress, CoreError> {
    let core = core.inner().clone();
    crate::app_core::run_blocking_command(request.context.request_id.clone(), move || core.job_status(&request.context, &request.job_id)).await
}

#[tauri::command]
pub async fn core_metrics_snapshot(
    request: CoreRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<CoreMetrics, CoreError> {
    request.context.validate()?;
    let core = core.inner().clone();
    crate::app_core::run_blocking_command(request.context.request_id, move || Ok(core.metrics())).await
}

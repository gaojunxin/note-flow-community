use crate::app_core::{
    AppCore, CoreError, CoreMetrics, JobProgress, ProfileStatus, RequestContext,
};
use crate::startup::StartupTimeline;
use serde::Deserialize;

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
pub fn core_profile_open(
    request: CoreRequest,
    core: tauri::State<'_, AppCore>,
    timeline: tauri::State<'_, StartupTimeline>,
) -> Result<ProfileStatus, CoreError> {
    let result = core.open_profile(&request.context);
    if result.is_ok() {
        timeline.mark("profile-ready");
    }
    result
}

#[tauri::command]
pub fn core_profile_close(
    request: CoreRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<ProfileStatus, CoreError> {
    core.close_profile(&request.context)
}

#[tauri::command]
pub fn core_job_submit_probe(
    request: SubmitProbeRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<JobProgress, CoreError> {
    core.submit_probe(&request.context, request.steps)
}

#[tauri::command]
pub fn core_job_cancel(
    request: JobRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<JobProgress, CoreError> {
    core.cancel_job(&request.context, &request.job_id)
}

#[tauri::command]
pub fn core_job_status(
    request: JobRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<JobProgress, CoreError> {
    core.job_status(&request.context, &request.job_id)
}

#[tauri::command]
pub fn core_metrics_snapshot(
    request: CoreRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<CoreMetrics, CoreError> {
    request.context.validate()?;
    Ok(core.metrics())
}

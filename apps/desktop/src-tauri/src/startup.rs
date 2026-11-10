use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupMilestone {
    name: String,
    elapsed_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupReport {
    schema_version: u8,
    started_at_ms: u64,
    frontend_navigation_ms: Option<f64>,
    milestones: Vec<StartupMilestone>,
}

pub struct StartupTimeline {
    started: Instant,
    started_at_ms: u64,
    report_path: PathBuf,
    milestones: Mutex<Vec<StartupMilestone>>,
    frontend_navigation_ms: Mutex<Option<f64>>,
}

impl StartupTimeline {
    pub fn new(report_path: PathBuf, started: Instant) -> Self {
        Self {
            started,
            started_at_ms: SystemTime::now()
                .checked_sub(started.elapsed())
                .unwrap_or(SystemTime::now())
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            report_path,
            milestones: Mutex::new(vec![StartupMilestone {
                name: "process-start".into(),
                elapsed_ms: 0,
            }]),
            frontend_navigation_ms: Mutex::new(None),
        }
    }

    pub fn mark(&self, name: &str) {
        let Ok(mut values) = self.milestones.lock() else {
            return;
        };
        if values.iter().any(|value| value.name == name) {
            return;
        }
        values.push(StartupMilestone {
            name: name.into(),
            elapsed_ms: self.started.elapsed().as_millis() as u64,
        });
        drop(values);
        let _ = self.persist();
    }

    fn set_frontend_navigation_ms(&self, value: Option<f64>) {
        if let Ok(mut stored) = self.frontend_navigation_ms.lock() {
            *stored = value.filter(|value| value.is_finite() && *value >= 0.0);
        }
    }

    fn persist(&self) -> Result<(), String> {
        let report = StartupReport {
            schema_version: 1,
            started_at_ms: self.started_at_ms,
            frontend_navigation_ms: *self
                .frontend_navigation_ms
                .lock()
                .map_err(|e| e.to_string())?,
            milestones: self.milestones.lock().map_err(|e| e.to_string())?.clone(),
        };
        if let Some(parent) = self.report_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let temporary = self.report_path.with_extension("json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if self.report_path.exists() {
            fs::remove_file(&self.report_path).map_err(|e| e.to_string())?;
        }
        fs::rename(temporary, &self.report_path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn frontend_ready(
    frontend_navigation_ms: Option<f64>,
    app: tauri::AppHandle,
    timeline: tauri::State<'_, StartupTimeline>,
) -> Result<(), String> {
    timeline.set_frontend_navigation_ms(frontend_navigation_ms);
    timeline.mark("frontend-ready");
    crate::native_startup::complete(&app).map_err(|error| error.to_string())?;
    timeline.mark("main-shown");
    timeline.persist()
}

pub fn start_timeout_guard(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        let timeline = app.state::<StartupTimeline>();
        let ready = timeline
            .milestones
            .lock()
            .map(|values| values.iter().any(|value| value.name == "frontend-ready"))
            .unwrap_or(true);
        if ready {
            return;
        }
        timeline.mark("frontend-ready-timeout");
        crate::native_startup::message(&app, "启动时间较长，正在继续加载…");
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn milestones_are_idempotent_and_ordered() {
        let path = std::env::temp_dir().join(format!(
            "note-flow-startup-{}-{}.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let timeline = StartupTimeline::new(path.clone(), Instant::now());
        timeline.mark("setup-ready");
        timeline.mark("setup-ready");
        let values = timeline.milestones.lock().unwrap();
        assert_eq!(values.len(), 2);
        assert_eq!(values[0].name, "process-start");
        assert_eq!(values[1].name, "setup-ready");
        drop(values);
        let _ = fs::remove_file(path);
    }
}

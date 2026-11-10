use super::{CoreError, CoreErrorCode, RequestContext};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub schema_version: u8,
    pub request_id: String,
    pub profile_id: String,
    pub job_id: String,
    pub state: JobState,
    pub phase: String,
    pub completed: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
    pub timestamp: DateTime<Utc>,
}

#[derive(Clone)]
struct JobControl {
    cancelled: Arc<AtomicBool>,
    progress: JobProgress,
}

struct JobWork {
    job_id: String,
    steps: u64,
    step_delay: Duration,
}

#[derive(Clone)]
pub struct JobQueue {
    sender: SyncSender<JobWork>,
    jobs: Arc<Mutex<HashMap<String, JobControl>>>,
    capacity: usize,
}

impl JobQueue {
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "job queue capacity must be positive");
        let (sender, receiver) = sync_channel(capacity);
        let jobs = Arc::new(Mutex::new(HashMap::new()));
        spawn_worker(receiver, jobs.clone());
        Self {
            sender,
            jobs,
            capacity,
        }
    }

    pub fn submit_probe(
        &self,
        context: &RequestContext,
        steps: u64,
        step_delay: Duration,
    ) -> Result<JobProgress, CoreError> {
        if steps == 0 {
            return Err(CoreError::invalid(
                &context.request_id,
                "steps must be positive",
            ));
        }
        let job_id = Uuid::new_v4().to_string();
        let progress = JobProgress {
            schema_version: 1,
            request_id: context.request_id.clone(),
            profile_id: context.profile_id.clone(),
            job_id: job_id.clone(),
            state: JobState::Queued,
            phase: "queued".into(),
            completed: 0,
            total: Some(steps),
            message: None,
            timestamp: Utc::now(),
        };
        self.jobs.lock().expect("jobs poisoned").insert(
            job_id.clone(),
            JobControl {
                cancelled: Arc::new(AtomicBool::new(false)),
                progress: progress.clone(),
            },
        );
        let work = JobWork {
            job_id: job_id.clone(),
            steps,
            step_delay,
        };
        if let Err(error) = self.sender.try_send(work) {
            self.jobs.lock().expect("jobs poisoned").remove(&job_id);
            return Err(match error {
                TrySendError::Full(_) => CoreError::new(
                    CoreErrorCode::Busy,
                    format!("job queue is full (capacity {})", self.capacity),
                    true,
                    &context.request_id,
                ),
                TrySendError::Disconnected(_) => CoreError::new(
                    CoreErrorCode::Internal,
                    "job worker is unavailable",
                    true,
                    &context.request_id,
                ),
            });
        }
        Ok(progress)
    }

    pub fn cancel(&self, context: &RequestContext, job_id: &str) -> Result<JobProgress, CoreError> {
        let mut jobs = self.jobs.lock().expect("jobs poisoned");
        let job = jobs.get_mut(job_id).ok_or_else(|| {
            CoreError::new(
                CoreErrorCode::NotFound,
                "job not found",
                false,
                &context.request_id,
            )
        })?;
        if job.progress.profile_id != context.profile_id {
            return Err(CoreError::new(
                CoreErrorCode::NotFound,
                "job not found",
                false,
                &context.request_id,
            ));
        }
        job.cancelled.store(true, Ordering::Release);
        if job.progress.state == JobState::Queued {
            job.progress.state = JobState::Cancelled;
            job.progress.phase = "cancelled".into();
            job.progress.timestamp = Utc::now();
        }
        Ok(job.progress.clone())
    }

    pub fn status(&self, context: &RequestContext, job_id: &str) -> Result<JobProgress, CoreError> {
        self.jobs
            .lock()
            .expect("jobs poisoned")
            .get(job_id)
            .filter(|job| job.progress.profile_id == context.profile_id)
            .map(|job| job.progress.clone())
            .ok_or_else(|| {
                CoreError::new(
                    CoreErrorCode::NotFound,
                    "job not found",
                    false,
                    &context.request_id,
                )
            })
    }

    pub fn count(&self) -> usize {
        self.jobs.lock().expect("jobs poisoned").len()
    }
}

fn spawn_worker(receiver: Receiver<JobWork>, jobs: Arc<Mutex<HashMap<String, JobControl>>>) {
    thread::Builder::new()
        .name("note-flow-core-jobs".into())
        .spawn(move || {
            while let Ok(work) = receiver.recv() {
                run_job(work, &jobs);
            }
        })
        .expect("failed to spawn core job worker");
}

fn run_job(work: JobWork, jobs: &Mutex<HashMap<String, JobControl>>) {
    let cancelled = {
        let mut values = jobs.lock().expect("jobs poisoned");
        let Some(job) = values.get_mut(&work.job_id) else {
            return;
        };
        if job.cancelled.load(Ordering::Acquire) {
            return;
        }
        job.progress.state = JobState::Running;
        job.progress.phase = "running".into();
        job.progress.timestamp = Utc::now();
        job.cancelled.clone()
    };
    let mut last_progress = Instant::now() - PROGRESS_INTERVAL;
    for step in 1..=work.steps {
        if cancelled.load(Ordering::Acquire) {
            finish(
                jobs,
                &work.job_id,
                JobState::Cancelled,
                "cancelled",
                step - 1,
            );
            return;
        }
        thread::sleep(work.step_delay.min(Duration::from_millis(25)));
        if last_progress.elapsed() >= PROGRESS_INTERVAL || step == work.steps {
            update(jobs, &work.job_id, step);
            last_progress = Instant::now();
        }
    }
    finish(
        jobs,
        &work.job_id,
        JobState::Completed,
        "completed",
        work.steps,
    );
}

fn update(jobs: &Mutex<HashMap<String, JobControl>>, job_id: &str, completed: u64) {
    if let Some(job) = jobs.lock().expect("jobs poisoned").get_mut(job_id) {
        job.progress.completed = completed;
        job.progress.timestamp = Utc::now();
    }
}

fn finish(
    jobs: &Mutex<HashMap<String, JobControl>>,
    job_id: &str,
    state: JobState,
    phase: &str,
    completed: u64,
) {
    if let Some(job) = jobs.lock().expect("jobs poisoned").get_mut(job_id) {
        job.progress.state = state;
        job.progress.phase = phase.into();
        job.progress.completed = completed;
        job.progress.timestamp = Utc::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(id: &str) -> RequestContext {
        RequestContext {
            request_id: Uuid::new_v4().to_string(),
            profile_id: id.into(),
        }
    }

    #[test]
    fn cancellation_is_observed_within_250ms() {
        let queue = JobQueue::new(2);
        let request = context("test");
        let job = queue
            .submit_probe(&request, 1000, Duration::from_millis(25))
            .unwrap();
        thread::sleep(Duration::from_millis(10));
        let started = Instant::now();
        queue.cancel(&request, &job.job_id).unwrap();
        loop {
            if queue.status(&request, &job.job_id).unwrap().state == JobState::Cancelled {
                break;
            }
            assert!(started.elapsed() < Duration::from_millis(250));
            thread::sleep(Duration::from_millis(5));
        }
    }
}

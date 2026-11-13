mod error;
mod jobs;

pub use error::{CoreError, CoreErrorCode};
pub use jobs::{JobProgress, JobQueue};

use crate::db::{open_profile_database, DbActorConfig, DbActorRegistry, DbError, ProfileId};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::Duration,
};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestContext {
    pub request_id: String,
    pub profile_id: String,
}

impl RequestContext {
    pub fn validate(&self) -> Result<(), CoreError> {
        if Uuid::parse_str(&self.request_id).is_err() {
            return Err(CoreError::invalid(
                &self.request_id,
                "requestId must be a UUID",
            ));
        }
        if self.profile_id.is_empty() || self.profile_id.len() > 128 {
            return Err(CoreError::invalid(
                &self.request_id,
                "profileId length must be 1..128",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatus {
    pub profile_id: String,
    pub generation: u64,
    pub open: bool,
}

#[derive(Default)]
struct Profiles {
    values: HashMap<String, u64>,
    next_generation: u64,
}

#[derive(Clone)]
pub struct AppCore {
    profiles: Arc<RwLock<Profiles>>,
    jobs: JobQueue,
    app_data_root: Arc<PathBuf>,
    database_root: Arc<PathBuf>,
    databases: Arc<DbActorRegistry>,
    db_config: DbActorConfig,
}

impl Default for AppCore {
    fn default() -> Self {
        // Tauri setup replaces this with an app-data rooted instance. Keeping a
        // deterministic fallback preserves non-Tauri tests and tooling.
        Self::new(std::env::temp_dir().join("note-flow-native-core"), 32)
    }
}

impl AppCore {
    pub fn new(app_data_root: impl Into<PathBuf>, job_capacity: usize) -> Self {
        let root:PathBuf=app_data_root.into();
        Self::with_database_root(root.clone(),root,job_capacity)
    }

    /// 资源继续位于数据目录，数据库绑定SQL插件的配置目录；旧数据目录数据库只做惰性保全。
    pub fn with_database_root(app_data_root: impl Into<PathBuf>,database_root:impl Into<PathBuf>,job_capacity:usize)->Self{
        Self {
            profiles: Arc::new(RwLock::new(Profiles::default())),
            jobs: JobQueue::new(job_capacity),
            app_data_root: Arc::new(app_data_root.into()),
            database_root: Arc::new(database_root.into()),
            databases: Arc::new(DbActorRegistry::default()),
            db_config: DbActorConfig::default(),
        }
    }

    pub fn app_data_root(&self) -> &Path {
        self.app_data_root.as_path()
    }

    pub fn open_profile(&self, context: &RequestContext) -> Result<ProfileStatus, CoreError> {
        context.validate()?;
        let mut profiles = self
            .profiles
            .write()
            .map_err(|_| self.internal_error(context, "profile registry is unavailable"))?;
        if let Some(generation) = profiles.values.get(&context.profile_id) {
            return Ok(ProfileStatus {
                profile_id: context.profile_id.clone(),
                generation: *generation,
                open: true,
            });
        }
        profiles.next_generation += 1;
        let generation = profiles.next_generation;
        let profile = ProfileId::new(context.profile_id.clone())
            .map_err(|error| self.database_error(context, error))?;
        let root = Arc::clone(&self.database_root);
        let legacy_root=Arc::clone(&self.app_data_root);
        let config = self.db_config;
        self.databases
            .get_or_open(profile, config, move |profile| {
                let mut connection=open_profile_database(root.as_path(),profile,config.busy_timeout_ms)?;
                crate::db::legacy_profile::preserve(connection.raw_mut(),legacy_root.as_path(),root.as_path(),profile)?;
                Ok(Box::new(connection) as Box<dyn crate::db::DbConnection>)
            })
            .map_err(|error| self.database_error(context, error))?;
        profiles
            .values
            .insert(context.profile_id.clone(), generation);
        Ok(ProfileStatus {
            profile_id: context.profile_id.clone(),
            generation,
            open: true,
        })
    }

    pub fn close_profile(&self, context: &RequestContext) -> Result<ProfileStatus, CoreError> {
        context.validate()?;
        let profile = ProfileId::new(context.profile_id.clone())
            .map_err(|error| self.database_error(context, error))?;
        let mut profiles = self
            .profiles
            .write()
            .map_err(|_| self.internal_error(context, "profile registry is unavailable"))?;
        let generation = profiles
            .values
            .get(&context.profile_id)
            .copied()
            .ok_or_else(|| {
                CoreError::new(
                    CoreErrorCode::ProfileNotFound,
                    "profile is not open",
                    false,
                    &context.request_id,
                )
            })?;
        self.databases
            .close(&profile)
            .map_err(|error| self.database_error(context, error))?;
        profiles.values.remove(&context.profile_id);
        Ok(ProfileStatus {
            profile_id: context.profile_id.clone(),
            generation,
            open: false,
        })
    }

    pub fn require_profile(&self, context: &RequestContext) -> Result<(), CoreError> {
        context.validate()?;
        if self
            .profiles
            .read()
            .expect("profiles poisoned")
            .values
            .contains_key(&context.profile_id)
        {
            Ok(())
        } else {
            Err(CoreError::new(
                CoreErrorCode::ProfileNotFound,
                "profile is not open",
                false,
                &context.request_id,
            ))
        }
    }

    /// 同步内部入口：在profile专属actor执行操作并等待结果；IPC必须使用异步入口，不能在窗口线程调用。
    pub fn with_profile_db<R, F>(
        &self,
        context: &RequestContext,
        operation: F,
    ) -> Result<R, CoreError>
    where
        R: Send + 'static,
        F: FnOnce(&mut rusqlite::Connection) -> Result<R, CoreError> + Send + 'static,
    {
        self.require_profile(context)?;
        let profile = ProfileId::new(context.profile_id.clone())
            .map_err(|error| self.database_error(context, error))?;
        let actor = self
            .databases
            .get(&profile)
            .map_err(|error| self.database_error(context, error))?
            .ok_or_else(|| {
                CoreError::new(
                    CoreErrorCode::ProfileNotFound,
                    "profile database is not open",
                    false,
                    &context.request_id,
                )
            })?;
        let request_id = context.request_id.clone();
        let result = actor
            .run(move |connection| {
                let sqlite = connection.sqlite()?;
                Ok(operation(sqlite))
            })
            .map_err(|error| {
                CoreError::new(CoreErrorCode::Database, error.to_string(), true, request_id)
            })?;
        result
    }

    /// IPC异步入口：actor排队、SQLite锁等待及结果接收均在阻塞线程完成，不占窗口或异步运行时工作线程。
    /// 事务与profile检查仍由原入口执行；Future取消不证明已经提交的数据库操作被取消。
    pub async fn with_profile_db_async<R, F>(&self, context: &RequestContext, operation: F) -> Result<R, CoreError>
    where
        R: Send + 'static,
        F: FnOnce(&mut rusqlite::Connection) -> Result<R, CoreError> + Send + 'static,
    {
        let core = self.clone();
        let context = context.clone();
        run_blocking_command(context.request_id.clone(), move || core.with_profile_db(&context, operation)).await
    }

    fn database_error(&self, context: &RequestContext, error: DbError) -> CoreError {
        CoreError::new(
            CoreErrorCode::Database,
            error.to_string(),
            true,
            &context.request_id,
        )
    }

    fn internal_error(&self, context: &RequestContext, message: &str) -> CoreError {
        CoreError::new(CoreErrorCode::Internal, message, false, &context.request_id)
    }

    pub fn submit_probe(
        &self,
        context: &RequestContext,
        steps: u64,
    ) -> Result<JobProgress, CoreError> {
        self.require_profile(context)?;
        self.jobs
            .submit_probe(context, steps, Duration::from_millis(10))
    }

    pub fn cancel_job(
        &self,
        context: &RequestContext,
        job_id: &str,
    ) -> Result<JobProgress, CoreError> {
        context.validate()?;
        self.jobs.cancel(context, job_id)
    }

    pub fn job_status(
        &self,
        context: &RequestContext,
        job_id: &str,
    ) -> Result<JobProgress, CoreError> {
        context.validate()?;
        self.jobs.status(context, job_id)
    }

    pub fn metrics(&self) -> CoreMetrics {
        CoreMetrics {
            open_profiles: self
                .profiles
                .read()
                .expect("profiles poisoned")
                .values
                .len(),
            known_jobs: self.jobs.count(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreMetrics {
    pub open_profiles: usize,
    pub known_jobs: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn context(profile: &str) -> RequestContext {
        RequestContext {
            request_id: Uuid::new_v4().to_string(),
            profile_id: profile.into(),
        }
    }

    #[test]
    fn explicit_database_root_shares_the_plugin_file_and_keeps_resource_root(){
        let temp=tempfile::tempdir().unwrap();let data=temp.path().join("data");let config=temp.path().join("config");std::fs::create_dir_all(&data).unwrap();
        let legacy=rusqlite::Connection::open(data.join("note-flow-v2-synthetic.db")).unwrap();legacy.execute_batch("CREATE TABLE notes(uid TEXT,content TEXT);INSERT INTO notes VALUES('old-only','Original old-root body')").unwrap();drop(legacy);
        let core=AppCore::with_database_root(&data,&config,32);let context=RequestContext{request_id:Uuid::new_v4().to_string(),profile_id:"synthetic".into()};core.open_profile(&context).unwrap();
        core.with_profile_db(&context,|db|{db.execute("INSERT INTO metadata VALUES('synthetic-shared-proof','committed')",[]).unwrap();Ok(())}).unwrap();
        let same=rusqlite::Connection::open(config.join("note-flow-v2-synthetic.db")).unwrap();assert_eq!(same.query_row("SELECT value FROM metadata WHERE key='synthetic-shared-proof'",[],|r|r.get::<_,String>(0)).unwrap(),"committed");assert_eq!(same.query_row("SELECT count(*) FROM notes",[],|r|r.get::<_,i64>(0)).unwrap(),0);assert_eq!(same.query_row("SELECT count(*) FROM profile_legacy_archives",[],|r|r.get::<_,i64>(0)).unwrap(),1);assert_eq!(core.app_data_root(),data.as_path());core.close_profile(&context).unwrap();core.open_profile(&context).unwrap();assert_eq!(same.query_row("SELECT count(*) FROM profile_legacy_archives",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn profile_lifecycle_is_idempotent_and_generation_changes_after_close() {
        let core = AppCore::new(
            std::env::temp_dir().join(format!("note-flow-core-{}", Uuid::new_v4())),
            2,
        );
        let request = context("p1");
        let first = core.open_profile(&request).unwrap();
        assert_eq!(
            core.open_profile(&request).unwrap().generation,
            first.generation
        );
        core.close_profile(&request).unwrap();
        assert!(core.require_profile(&request).is_err());
        assert!(core.open_profile(&request).unwrap().generation > first.generation);
    }

    #[test]
    fn profile_databases_are_isolated_and_reopen_persists_data() {
        let root = std::env::temp_dir().join(format!("note-flow-core-{}", Uuid::new_v4()));
        let core = AppCore::new(&root, 2);
        let first = context("first");
        let second = context("second");
        core.open_profile(&first).unwrap();
        core.open_profile(&second).unwrap();

        core.with_profile_db(&first, |db| {
            db.execute_batch(
                "CREATE TABLE bridge_test(value TEXT); INSERT INTO bridge_test VALUES('first')",
            )
            .map_err(|error| {
                CoreError::new(CoreErrorCode::Database, error.to_string(), false, "test")
            })
        })
        .unwrap();
        let second_has_table = core
            .with_profile_db(&second, |db| {
                Ok(db.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='bridge_test'",
                [],
                |row| row.get::<_, i64>(0),
            ).unwrap())
            })
            .unwrap();
        assert_eq!(second_has_table, 0);

        core.close_profile(&first).unwrap();
        assert_eq!(
            core.with_profile_db(&first, |_| Ok(())).unwrap_err().code,
            CoreErrorCode::ProfileNotFound
        );
        core.open_profile(&first).unwrap();
        let value = core
            .with_profile_db(&first, |db| {
                Ok(db
                    .query_row("SELECT value FROM bridge_test", [], |row| {
                        row.get::<_, String>(0)
                    })
                    .unwrap())
            })
            .unwrap();
        assert_eq!(value, "first");

        drop(core);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn operation_errors_keep_their_core_error_code() {
        let root = std::env::temp_dir().join(format!("note-flow-core-{}", Uuid::new_v4()));
        let core = AppCore::new(&root, 2);
        let request = context("conflict");
        core.open_profile(&request).unwrap();
        let error = core
            .with_profile_db(&request, |_| {
                Err::<(), _>(CoreError::new(
                    CoreErrorCode::Conflict,
                    "version conflict",
                    false,
                    "operation",
                ))
            })
            .unwrap_err();
        assert_eq!(error.code, CoreErrorCode::Conflict);
        drop(core);
        fs::remove_dir_all(root).unwrap();
    }
}

/// 将可能阻塞的原生命令交给阻塞线程池；任务异常表示结果未知，不自动重试或改用另一存储。
pub async fn run_blocking_command<R, F>(request_id: String, operation: F) -> Result<R, CoreError>
where
    R: Send + 'static,
    F: FnOnce() -> Result<R, CoreError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation).await.map_err(|_| {
        CoreError::new(CoreErrorCode::Internal, "本机操作线程异常，执行结果尚未确认，请重新加载后核对", false, request_id)
    })?
}

#[cfg(test)]
mod command_dispatch_tests {
    use super::*;

    #[tokio::test(flavor = "current_thread")]
    async fn blocking_command_leaves_the_single_runtime_thread_available() {
        let (entered, ready) = tokio::sync::oneshot::channel();
        let (release, waiting) = std::sync::mpsc::channel();
        let work = tokio::spawn(run_blocking_command("synthetic".into(), move || {
            let _ = entered.send(());
            waiting.recv_timeout(Duration::from_secs(2)).map_err(|_| {
                CoreError::new(CoreErrorCode::Internal, "合成等待未被释放", false, "synthetic")
            })?;
            Ok(17)
        }));
        tokio::time::timeout(Duration::from_secs(1), ready).await.unwrap().unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!work.is_finished(), "阻塞任务仍在等待时异步计时器必须能运行");
        release.send(()).unwrap();
        assert_eq!(work.await.unwrap().unwrap(), 17);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn command_worker_panic_preserves_unknown_outcome_and_original_request() {
        let error = run_blocking_command::<(), _>("original-request".into(), || panic!("synthetic worker panic")).await.unwrap_err();
        assert_eq!(error.code, CoreErrorCode::Internal);
        assert_eq!(error.request_id, "original-request");
        assert!(!error.retryable);
    }
}

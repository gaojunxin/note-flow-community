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
        Self {
            profiles: Arc::new(RwLock::new(Profiles::default())),
            jobs: JobQueue::new(job_capacity),
            app_data_root: Arc::new(app_data_root.into()),
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
        let root = Arc::clone(&self.app_data_root);
        let config = self.db_config;
        self.databases
            .get_or_open(profile, config, move |profile| {
                open_profile_database(root.as_path(), profile, config.busy_timeout_ms)
                    .map(|connection| Box::new(connection) as Box<dyn crate::db::DbConnection>)
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

    /// Executes database work on the profile's single owning actor thread.
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

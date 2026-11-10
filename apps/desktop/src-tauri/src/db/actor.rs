use std::{
    any::Any,
    collections::HashMap,
    fmt,
    sync::{mpsc, Arc, Mutex},
    thread,
};

pub type DbResult<T> = Result<T, DbError>;

/// Minimal surface required from the eventual SQLite adapter.
pub trait DbConnection: Send + 'static {
    fn execute_batch(&mut self, sql: &str) -> DbResult<()>;

    fn query_i64(&mut self, _sql: &str) -> DbResult<i64> {
        Err(DbError::Backend(
            "scalar queries are not supported by this connection".into(),
        ))
    }

    /// Exposes SQLite only while executing on the owning actor thread.
    fn sqlite(&mut self) -> DbResult<&mut rusqlite::Connection> {
        Err(DbError::Backend(
            "connection is not backed by SQLite".into(),
        ))
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct ProfileId(String);

impl ProfileId {
    pub fn new(value: impl Into<String>) -> DbResult<Self> {
        let value = value.into();
        let valid = !value.is_empty()
            && value.len() <= 128
            && value
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'));
        if !valid {
            return Err(DbError::InvalidProfile(value));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug)]
pub struct DbActorConfig {
    pub busy_timeout_ms: u32,
}

impl Default for DbActorConfig {
    fn default() -> Self {
        Self {
            busy_timeout_ms: 5_000,
        }
    }
}

#[derive(Debug)]
pub enum DbError {
    InvalidProfile(String),
    Backend(String),
    ActorStopped,
    ResponseTypeMismatch,
    RegistryPoisoned,
    WorkerPanicked,
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidProfile(value) => write!(f, "invalid database profile id: {value:?}"),
            Self::Backend(message) => write!(f, "database backend error: {message}"),
            Self::ActorStopped => f.write_str("database actor has stopped"),
            Self::ResponseTypeMismatch => f.write_str("database actor returned an unexpected type"),
            Self::RegistryPoisoned => f.write_str("database actor registry lock is poisoned"),
            Self::WorkerPanicked => f.write_str("database operation panicked"),
        }
    }
}

impl std::error::Error for DbError {}

impl DbError {
    pub(crate) fn sqlite(error: rusqlite::Error) -> Self {
        Self::Backend(error.to_string())
    }
}

type ErasedResult = DbResult<Box<dyn Any + Send>>;
// 数据库连接始终留在所属工作线程；调用方只发送可跨线程的闭包与结果通道，不能借出连接。
type Operation = Box<dyn FnOnce(&mut dyn DbConnection) -> ErasedResult + Send>;

enum Message {
    Run {
        operation: Operation,
        response: mpsc::Sender<ErasedResult>,
    },
    Shutdown {
        response: mpsc::Sender<()>,
    },
}

/// Cloneable handle to one profile's strictly serial database worker.
#[derive(Clone)]
pub struct DbActor {
    profile: ProfileId,
    sender: mpsc::Sender<Message>,
}

impl DbActor {
    pub fn spawn(
        profile: ProfileId,
        mut connection: Box<dyn DbConnection>,
        config: DbActorConfig,
    ) -> DbResult<Self> {
        initialise(&mut *connection, config)?;
        let (sender, receiver) = mpsc::channel::<Message>();
        let thread_name = format!("note-flow-db-{}", profile.as_str());
        thread::Builder::new()
            .name(thread_name)
            .spawn(move || worker_loop(receiver, connection))
            .map_err(|error| {
                DbError::Backend(format!("failed to start database actor: {error}"))
            })?;
        Ok(Self { profile, sender })
    }

    pub fn profile(&self) -> &ProfileId {
        &self.profile
    }

    /// Runs one operation on the profile worker. Calls are serialized in queue order.
    pub fn run<R, F>(&self, operation: F) -> DbResult<R>
    where
        R: Any + Send + 'static,
        F: FnOnce(&mut dyn DbConnection) -> DbResult<R> + Send + 'static,
    {
        self.dispatch(Box::new(move |connection| {
            operation(connection).map(|value| Box::new(value) as Box<dyn Any + Send>)
        }))
    }

    /// Runs a transaction on the worker and guarantees rollback on error or panic.
    pub fn transaction<R, F>(&self, operation: F) -> DbResult<R>
    where
        R: Any + Send + 'static,
        F: FnOnce(&mut dyn DbConnection) -> DbResult<R> + Send + 'static,
    {
        self.dispatch(Box::new(move |connection: &mut dyn DbConnection| {
            // 把回调错误和panic都收束到回滚路径；只有COMMIT本身成功，调用方才收到成功值。
            connection.execute_batch("BEGIN IMMEDIATE")?;
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| operation(connection)));
            match result {
                Ok(Ok(value)) => {
                    if let Err(commit_error) = connection.execute_batch("COMMIT") {
                        let _ = connection.execute_batch("ROLLBACK");
                        Err(commit_error)
                    } else {
                        Ok(Box::new(value) as Box<dyn Any + Send>)
                    }
                }
                Ok(Err(error)) => match connection.execute_batch("ROLLBACK") {
                    Ok(()) => Err(error),
                    Err(rollback_error) => Err(DbError::Backend(format!(
                        "{error}; rollback also failed: {rollback_error}"
                    ))),
                },
                Err(_) => match connection.execute_batch("ROLLBACK") {
                    Ok(()) => Err(DbError::WorkerPanicked),
                    Err(rollback_error) => Err(DbError::Backend(format!(
                        "database operation panicked; rollback also failed: {rollback_error}"
                    ))),
                },
            }
        }))
    }

    /// Stops the owning worker and waits until its SQLite connection is dropped.
    pub fn shutdown(&self) -> DbResult<()> {
        let (response_tx, response_rx) = mpsc::channel();
        self.sender
            .send(Message::Shutdown {
                response: response_tx,
            })
            .map_err(|_| DbError::ActorStopped)?;
        response_rx.recv().map_err(|_| DbError::ActorStopped)
    }

    fn dispatch<R>(&self, operation: Operation) -> DbResult<R>
    where
        R: Any + Send + 'static,
    {
        let (response_tx, response_rx) = mpsc::channel();
        self.sender
            .send(Message::Run {
                operation,
                response: response_tx,
            })
            .map_err(|_| DbError::ActorStopped)?;
        let boxed = response_rx.recv().map_err(|_| DbError::ActorStopped)??;
        boxed
            .downcast::<R>()
            .map(|value| *value)
            .map_err(|_| DbError::ResponseTypeMismatch)
    }
}

fn initialise(connection: &mut dyn DbConnection, config: DbActorConfig) -> DbResult<()> {
    connection.execute_batch("PRAGMA journal_mode = WAL")?;
    connection.execute_batch("PRAGMA foreign_keys = ON")?;
    connection.execute_batch(&format!("PRAGMA busy_timeout = {}", config.busy_timeout_ms))?;
    Ok(())
}

fn worker_loop(receiver: mpsc::Receiver<Message>, mut connection: Box<dyn DbConnection>) {
    while let Ok(message) = receiver.recv() {
        match message {
            Message::Run {
                operation,
                response,
            } => {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    operation(&mut *connection)
                }))
                .unwrap_or(Err(DbError::WorkerPanicked));
                let _ = response.send(result);
            }
            Message::Shutdown { response } => {
                drop(connection);
                let _ = response.send(());
                return;
            }
        }
    }
}

/// Owns at most one actor per profile, preventing accidental cross-profile sharing.
#[derive(Default)]
pub struct DbActorRegistry {
    actors: Mutex<HashMap<ProfileId, Arc<DbActor>>>,
}

impl DbActorRegistry {
    pub fn get_or_open<F>(
        &self,
        profile: ProfileId,
        config: DbActorConfig,
        open: F,
    ) -> DbResult<Arc<DbActor>>
    where
        F: FnOnce(&ProfileId) -> DbResult<Box<dyn DbConnection>>,
    {
        let mut actors = self.actors.lock().map_err(|_| DbError::RegistryPoisoned)?;
        if let Some(actor) = actors.get(&profile) {
            return Ok(Arc::clone(actor));
        }
        let connection = open(&profile)?;
        let actor = Arc::new(DbActor::spawn(profile.clone(), connection, config)?);
        actors.insert(profile, Arc::clone(&actor));
        Ok(actor)
    }

    pub fn close(&self, profile: &ProfileId) -> DbResult<bool> {
        let actor = self
            .actors
            .lock()
            .map_err(|_| DbError::RegistryPoisoned)
            .map(|mut actors| actors.remove(profile))?;
        if let Some(actor) = actor {
            actor.shutdown()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn get(&self, profile: &ProfileId) -> DbResult<Option<Arc<DbActor>>> {
        self.actors
            .lock()
            .map_err(|_| DbError::RegistryPoisoned)
            .map(|actors| actors.get(profile).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            MutexGuard,
        },
        time::Duration,
    };

    #[derive(Clone)]
    struct FakeConnection {
        log: Arc<Mutex<Vec<String>>>,
    }

    impl DbConnection for FakeConnection {
        fn execute_batch(&mut self, sql: &str) -> DbResult<()> {
            self.log.lock().unwrap().push(sql.to_owned());
            Ok(())
        }
    }

    fn actor(profile: &str) -> (DbActor, Arc<Mutex<Vec<String>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let connection = FakeConnection {
            log: Arc::clone(&log),
        };
        let actor = DbActor::spawn(
            ProfileId::new(profile).unwrap(),
            Box::new(connection),
            DbActorConfig::default(),
        )
        .unwrap();
        (actor, log)
    }

    fn entries(log: &Arc<Mutex<Vec<String>>>) -> MutexGuard<'_, Vec<String>> {
        log.lock().unwrap()
    }

    #[test]
    fn configures_every_connection() {
        let (_actor, log) = actor("primary");
        assert_eq!(
            &*entries(&log),
            &[
                "PRAGMA journal_mode = WAL",
                "PRAGMA foreign_keys = ON",
                "PRAGMA busy_timeout = 5000"
            ]
        );
    }

    #[test]
    fn commits_successful_transaction() {
        let (actor, log) = actor("primary");
        let value = actor
            .transaction(|connection| {
                connection.execute_batch("INSERT note")?;
                Ok(42_u32)
            })
            .unwrap();
        assert_eq!(value, 42);
        assert!(entries(&log).ends_with(&[
            "BEGIN IMMEDIATE".into(),
            "INSERT note".into(),
            "COMMIT".into()
        ]));
    }

    #[test]
    fn rolls_back_failed_transaction() {
        let (actor, log) = actor("primary");
        let result: DbResult<()> = actor.transaction(|connection| {
            connection.execute_batch("UPDATE note")?;
            Err(DbError::Backend("expected failure".into()))
        });
        assert!(matches!(result, Err(DbError::Backend(_))));
        assert!(entries(&log).ends_with(&[
            "BEGIN IMMEDIATE".into(),
            "UPDATE note".into(),
            "ROLLBACK".into()
        ]));
    }

    #[test]
    fn registry_reuses_only_the_same_profile() {
        let registry = DbActorRegistry::default();
        let first = registry
            .get_or_open(
                ProfileId::new("a").unwrap(),
                DbActorConfig::default(),
                |_| {
                    Ok(Box::new(FakeConnection {
                        log: Arc::default(),
                    }))
                },
            )
            .unwrap();
        let again = registry
            .get_or_open(
                ProfileId::new("a").unwrap(),
                DbActorConfig::default(),
                |_| panic!(),
            )
            .unwrap();
        let other = registry
            .get_or_open(
                ProfileId::new("b").unwrap(),
                DbActorConfig::default(),
                |_| {
                    Ok(Box::new(FakeConnection {
                        log: Arc::default(),
                    }))
                },
            )
            .unwrap();
        assert!(Arc::ptr_eq(&first, &again));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[test]
    fn rejects_unsafe_profile_names() {
        assert!(matches!(
            ProfileId::new("../shared"),
            Err(DbError::InvalidProfile(_))
        ));
    }

    #[test]
    fn concurrent_callers_are_serialized() {
        let (actor, _log) = actor("primary");
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let mut callers = Vec::new();
        for _ in 0..8 {
            let actor = actor.clone();
            let active = Arc::clone(&active);
            let maximum = Arc::clone(&maximum);
            callers.push(thread::spawn(move || {
                actor.run(move |_| {
                    let now = active.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum.fetch_max(now, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(2));
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                })
            }));
        }
        for caller in callers {
            caller.join().unwrap().unwrap();
        }
        assert_eq!(maximum.load(Ordering::SeqCst), 1);
    }
}

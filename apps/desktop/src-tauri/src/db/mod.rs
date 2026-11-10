//! Serialized database access for the desktop native core.
//!
//! The actor deliberately depends on a small backend trait. This keeps queueing,
//! profile isolation and transaction semantics testable without coupling the
//! native core to Tauri's SQL plugin. A SQLite adapter can implement
//! [`DbConnection`] once a direct SQLite dependency is selected.

mod actor;
mod migrations;
mod sqlite;

pub use actor::{
    DbActor, DbActorConfig, DbActorRegistry, DbConnection, DbError, DbResult, ProfileId,
};
pub use migrations::{run_migrations, LATEST_SCHEMA_VERSION};
pub use sqlite::{open_profile_database, profile_database_path, SqliteConnection};

pub mod local_transaction;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

const DEFAULT_PAGE_SIZE: u32 = 50;
const MAX_PAGE_SIZE: u32 = 200;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NoteRepositoryErrorCode {
    InvalidArgument,
    NotFound,
    Conflict,
    Database,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRepositoryError {
    pub code: NoteRepositoryErrorCode,
    pub message: String,
    pub retryable: bool,
}

impl NoteRepositoryError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: NoteRepositoryErrorCode::InvalidArgument,
            message: message.into(),
            retryable: false,
        }
    }

    fn not_found() -> Self {
        Self {
            code: NoteRepositoryErrorCode::NotFound,
            message: "note not found".into(),
            retryable: false,
        }
    }

    fn conflict() -> Self {
        Self {
            code: NoteRepositoryErrorCode::Conflict,
            message: "note version conflict".into(),
            retryable: false,
        }
    }

    fn database() -> Self {
        Self {
            code: NoteRepositoryErrorCode::Database,
            message: "note database operation failed".into(),
            retryable: false,
        }
    }
}

pub type Result<T> = std::result::Result<T, NoteRepositoryError>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNote {
    pub uid: String,
    pub title: String,
    pub content: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNote {
    pub uid: String,
    pub title: String,
    pub content: String,
    pub updated_at: String,
    pub expected_version: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub uid: String,
    pub title: String,
    pub excerpt: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDetail {
    pub uid: String,
    pub title: String,
    pub content: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePage {
    pub items: Vec<NoteSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub uid: String,
    pub title: String,
    pub snippet: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchPage {
    pub items: Vec<SearchHit>,
    pub total: u64,
    pub page: u32,
    pub size: u32,
    pub has_more: bool,
}

pub struct NoteRepository<'a> {
    connection: &'a mut Connection,
}

impl<'a> NoteRepository<'a> {
    pub fn new(connection: &'a mut Connection) -> Self {
        Self { connection }
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    pub fn list(&self, cursor: Option<&str>, limit: Option<u32>) -> Result<NotePage> {
        let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE);
        if limit == 0 || limit > MAX_PAGE_SIZE {
            return Err(NoteRepositoryError::invalid(
                "page size must be between 1 and 200",
            ));
        }
        let cursor = cursor.map(decode_cursor).transpose()?;
        let mut statement = self
            .connection
            .prepare(
            "SELECT uid, title, coalesce(nullif(json_extract(entity_json,'$.summary'),''),content), updated_at, coalesce(CAST(json_extract(entity_json,'$.version') AS INTEGER),version)
             FROM notes
             WHERE deleted = 0 AND coalesce(status, 'active') <> 'archived'
               AND (?1 IS NULL OR updated_at < ?1 OR (updated_at = ?1 AND uid < ?2))
             ORDER BY updated_at DESC, uid DESC LIMIT ?3",
            )
            .map_err(|_| NoteRepositoryError::database())?;
        let (time, uid) = cursor.map_or((None, None), |(t, u)| (Some(t), Some(u)));
        let rows = statement
            .query_map(params![time, uid, i64::from(limit) + 1], |row| {
                let source: String = row.get(2)?;
                Ok(NoteSummary {
                    uid: row.get(0)?,
                    title: row.get(1)?,
                    excerpt: legacy_list_excerpt(&source),
                    updated_at: row.get(3)?,
                    version: row.get(4)?,
                })
            })
            .map_err(|_| NoteRepositoryError::database())?;
        let mut items = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| NoteRepositoryError::database())?;
        let has_more = items.len() > limit as usize;
        items.truncate(limit as usize);
        let next_cursor = if has_more {
            items.last().map(|n| encode_cursor(&n.updated_at, &n.uid))
        } else {
            None
        };
        Ok(NotePage { items, next_cursor })
    }

    pub fn get(&self, uid: &str) -> Result<NoteDetail> {
        validate_uid(uid)?;
        self.connection.query_row(
            "SELECT uid, title, content, updated_at, coalesce(CAST(json_extract(entity_json,'$.version') AS INTEGER),version) FROM notes WHERE uid = ?1 AND deleted = 0",
            [uid],
            |row| Ok(NoteDetail { uid: row.get(0)?, title: row.get(1)?, content: row.get(2)?, updated_at: row.get(3)?, version: row.get(4)? })
        ).optional().map_err(|_| NoteRepositoryError::database())?.ok_or_else(NoteRepositoryError::not_found)
    }

    pub fn create(&mut self, input: CreateNote) -> Result<NoteDetail> {
        validate_uid(&input.uid)?;
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| NoteRepositoryError::database())?;
        let changed = transaction.execute(
            "INSERT INTO notes(uid, title, content, status, deleted, updated_at, search_text, entity_json, version)
             VALUES(?1, ?2, ?3, 'active', 0, ?4, lower(?2 || ' ' || ?3),
               json_object('uid',?1,'title',?2,'content',?3,'status','active','deleted',json('false'),'updatedAt',?4,'version',1,'syncStatus','pending'), 1)
             ON CONFLICT(uid) DO NOTHING",
            params![input.uid, input.title, input.content, input.updated_at],
        ).map_err(|_| NoteRepositoryError::database())?;
        if changed == 0 {
            return Err(NoteRepositoryError::conflict());
        }
        write_projections(
            &transaction,
            &input.uid,
            &input.title,
            &input.content,
            &input.updated_at,
            1,
        )?;
        insert_outbox(&transaction, &input.uid, "create", 1, &input.updated_at)?;
        transaction
            .commit()
            .map_err(|_| NoteRepositoryError::database())?;
        self.get(&input.uid)
    }

    pub fn update(&mut self, input: UpdateNote) -> Result<NoteDetail> {
        validate_uid(&input.uid)?;
        if input.expected_version < 1 {
            return Err(NoteRepositoryError::invalid(
                "expected version must be positive",
            ));
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|_| NoteRepositoryError::database())?;
        let changed = transaction.execute(
            "UPDATE notes SET title = ?1, content = ?2, updated_at = ?3,
               search_text = lower(?1 || ' ' || ?2), version = version + 1,
               entity_json = json_set(entity_json, '$.title', ?1, '$.content', ?2, '$.updatedAt', ?3,
                 '$.version', version + 1, '$.syncStatus', 'pending')
             WHERE uid = ?4 AND deleted = 0 AND version = ?5",
            params![input.title, input.content, input.updated_at, input.uid, input.expected_version],
        ).map_err(|_| NoteRepositoryError::database())?;
        if changed == 0 {
            let exists = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM notes WHERE uid = ?1 AND deleted = 0)",
                    [&input.uid],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|_| NoteRepositoryError::database())?;
            return Err(if exists {
                NoteRepositoryError::conflict()
            } else {
                NoteRepositoryError::not_found()
            });
        }
        let version = input.expected_version + 1;
        write_projections(
            &transaction,
            &input.uid,
            &input.title,
            &input.content,
            &input.updated_at,
            version,
        )?;
        insert_outbox(
            &transaction,
            &input.uid,
            "update",
            version,
            &input.updated_at,
        )?;
        transaction
            .commit()
            .map_err(|_| NoteRepositoryError::database())?;
        self.get(&input.uid)
    }

    pub fn search(
        &self,
        query: &str,
        page: Option<u32>,
        size: Option<u32>,
    ) -> Result<NoteSearchPage> {
        let query = query.trim();
        if query.is_empty() {
            return Err(NoteRepositoryError::invalid(
                "search query must not be empty",
            ));
        }
        let page = page.unwrap_or(1);
        let size = size.unwrap_or(20);
        if page == 0 {
            return Err(NoteRepositoryError::invalid("search page must be positive"));
        }
        if size == 0 || size > MAX_PAGE_SIZE {
            return Err(NoteRepositoryError::invalid(
                "search size must be between 1 and 200",
            ));
        }
        let offset = u64::from(page - 1)
            .checked_mul(u64::from(size))
            .and_then(|value| i64::try_from(value).ok())
            .ok_or_else(|| NoteRepositoryError::invalid("search page is too large"))?;
        // Keep the native read byte-for-byte compatible with sqliteNotes.search:
        // short queries use the normalized mirror text, while trigram FTS needs
        // a quoted literal.  Return the raw body so both paths build the same
        // 240-character context rather than an FTS-marked snippet.
        let short = query.chars().count() < 3;
        let sql = if short {
            "SELECT uid, title, content, updated_at
             FROM notes
             WHERE deleted = 0 AND coalesce(status, 'inbox') <> 'archived'
               AND search_text LIKE ?1 ESCAPE '\\'
             ORDER BY CASE WHEN lower(title) LIKE ?1 ESCAPE '\\' THEN 0 ELSE 1 END,
                      updated_at DESC
             LIMIT ?2 OFFSET ?3"
        } else {
            "SELECT n.uid, n.title, n.content, n.updated_at
             FROM note_search JOIN notes n ON n.uid = note_search.uid
             WHERE note_search MATCH ?1
             ORDER BY bm25(note_search, 0, 8, 1), n.updated_at DESC LIMIT ?2 OFFSET ?3"
        };
        let parameter = if short {
            like_pattern(query)
        } else {
            fts_literal(query)
        };
        let mut statement = self
            .connection
            .prepare(sql)
            .map_err(|_| NoteRepositoryError::database())?;
        let rows = statement
            .query_map(params![parameter, size, offset], |row| {
                let content: String = row.get(2)?;
                Ok(SearchHit {
                    uid: row.get(0)?,
                    title: row.get(1)?,
                    snippet: legacy_search_excerpt(&content, query),
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|_| NoteRepositoryError::invalid("invalid search query"))?;
        let items = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| NoteRepositoryError::database())?;
        let count_sql = if short {
            "SELECT count(*) FROM notes WHERE deleted = 0 AND coalesce(status, 'inbox') <> 'archived' AND search_text LIKE ?1 ESCAPE '\\'"
        } else {
            "SELECT count(*) FROM note_search JOIN notes n ON n.uid = note_search.uid WHERE note_search MATCH ?1"
        };
        let total: u64 = self
            .connection
            .query_row(count_sql, [parameter], |row| row.get(0))
            .map_err(|_| NoteRepositoryError::database())?;
        Ok(NoteSearchPage {
            items,
            total,
            page,
            size,
            has_more: u64::try_from(offset).unwrap_or(u64::MAX) + u64::from(size) < total,
        })
    }
}

fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn fts_literal(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}

fn legacy_search_excerpt(content: &str, query: &str) -> String {
    // sqliteNotes finds the query in normalized text, then applies that UTF-16
    // offset to the original body. Preserve that legacy quirk exactly.
    let normalized = legacy_normalize(content);
    let at = normalized
        .find(query)
        .map(|byte| normalized[..byte].encode_utf16().count())
        .unwrap_or(0);
    utf16_slice(content, at.saturating_sub(60), 240)
}

fn legacy_normalize(value: &str) -> String {
    let mut normalized = String::new();
    let mut pending_space = false;
    for character in value.nfkc().flat_map(char::to_lowercase) {
        let character = if matches!(
            character,
            '`' | '*' | '_' | '>' | '#' | '[' | ']' | '(' | ')' | '{' | '}' | '!' | '|' | '~'
        ) {
            ' '
        } else {
            character
        };
        if character.is_whitespace() {
            pending_space = !normalized.is_empty();
        } else {
            if pending_space {
                normalized.push(' ');
                pending_space = false;
            }
            normalized.push(character);
        }
    }
    normalized
}

fn legacy_list_excerpt(content: &str) -> String {
    let mut compact = String::new();
    let mut whitespace = false;
    for character in content.chars() {
        if character.is_whitespace() {
            if !whitespace {
                compact.push(' ');
            }
            whitespace = true;
        } else {
            compact.push(character);
            whitespace = false;
        }
    }
    utf16_slice(&compact, 0, 180)
}

fn utf16_slice(value: &str, start: usize, length: usize) -> String {
    String::from_utf16_lossy(
        &value
            .encode_utf16()
            .skip(start)
            .take(length)
            .collect::<Vec<_>>(),
    )
}

fn insert_outbox(
    transaction: &Transaction<'_>,
    aggregate_uid: &str,
    event_type: &str,
    version: i64,
    created_at: &str,
) -> Result<()> {
    let operation_id = Uuid::new_v4().to_string();
    let entity_json: String = transaction
        .query_row(
            "SELECT entity_json FROM notes WHERE uid = ?1",
            [aggregate_uid],
            |row| row.get(0),
        )
        .map_err(|_| NoteRepositoryError::database())?;
    let payload: serde_json::Value =
        serde_json::from_str(&entity_json).map_err(|_| NoteRepositoryError::database())?;
    let operation = serde_json::json!({
        "operationId": operation_id, "entityType": "note", "entityUid": aggregate_uid,
        "action": event_type, "baseVersion": version - 1, "status": "pending", "attempts": 0,
        "createdAt": created_at, "payload": payload
    });
    transaction.execute(
        "INSERT INTO outbox(operation_id, entity_uid, status, created_at, operation_json) VALUES(?1, ?2, 'pending', ?3, ?4)",
        params![operation_id, aggregate_uid, created_at, operation.to_string()],
    ).map(|_| ()).map_err(|_| NoteRepositoryError::database())
}

fn write_projections(
    transaction: &Transaction<'_>,
    uid: &str,
    title: &str,
    content: &str,
    updated_at: &str,
    version: i64,
) -> Result<()> {
    let summary = serde_json::json!({ "uid": uid, "title": title, "excerpt": content.chars().take(240).collect::<String>(), "status": "active", "deleted": false, "updatedAt": updated_at, "version": version });
    transaction.execute(
        "INSERT INTO note_summaries(uid,status,deleted,updated_at,summary_json) VALUES(?1,'active',0,?2,?3)
         ON CONFLICT(uid) DO UPDATE SET status='active',deleted=0,updated_at=excluded.updated_at,summary_json=excluded.summary_json",
        params![uid, updated_at, summary.to_string()],
    ).map_err(|_| NoteRepositoryError::database())?;
    transaction
        .execute("DELETE FROM note_search WHERE uid = ?1", [uid])
        .map_err(|_| NoteRepositoryError::database())?;
    transaction
        .execute(
            "INSERT INTO note_search(uid,title,content) VALUES(?1,?2,?3)",
            params![uid, title, content],
        )
        .map_err(|_| NoteRepositoryError::database())?;
    Ok(())
}

fn validate_uid(uid: &str) -> Result<()> {
    if uid.is_empty()
        || uid.len() > 128
        || !uid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        Err(NoteRepositoryError::invalid("invalid note uid"))
    } else {
        Ok(())
    }
}

fn encode_cursor(updated_at: &str, uid: &str) -> String {
    let time_hex = updated_at
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let uid_hex = uid
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("v1.{time_hex}.{uid_hex}")
}

fn decode_cursor(cursor: &str) -> Result<(String, String)> {
    let mut parts = cursor.split('.');
    if parts.next() != Some("v1") {
        return Err(NoteRepositoryError::invalid("invalid note cursor"));
    }
    let time_hex = parts
        .next()
        .ok_or_else(|| NoteRepositoryError::invalid("invalid note cursor"))?;
    let hex = parts
        .next()
        .filter(|_| parts.next().is_none())
        .ok_or_else(|| NoteRepositoryError::invalid("invalid note cursor"))?;
    if hex.len() % 2 != 0 {
        return Err(NoteRepositoryError::invalid("invalid note cursor"));
    }
    let decode_hex = |value: &str| -> Result<String> {
        if value.len() % 2 != 0 {
            return Err(NoteRepositoryError::invalid("invalid note cursor"));
        }
        let bytes = (0..value.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&value[index..index + 2], 16))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| NoteRepositoryError::invalid("invalid note cursor"))?;
        String::from_utf8(bytes).map_err(|_| NoteRepositoryError::invalid("invalid note cursor"))
    };
    let updated_at = decode_hex(time_hex)?;
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| NoteRepositoryError::invalid("invalid note cursor"))?;
    let uid = String::from_utf8(bytes)
        .map_err(|_| NoteRepositoryError::invalid("invalid note cursor"))?;
    validate_uid(&uid)?;
    Ok((updated_at, uid))
}

/// Temporary schema helper for repository tests. Production must install this
/// through the central, versioned migration runner.
#[cfg(test)]
fn install_test_schema(connection: &Connection) {
    connection.execute_batch(TEST_SCHEMA).unwrap();
}

#[cfg(test)]
const TEST_SCHEMA: &str = r#"
CREATE TABLE notes (
  uid TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT,
  deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT, search_text TEXT NOT NULL,
  entity_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE TABLE outbox (
  operation_id TEXT PRIMARY KEY NOT NULL, entity_uid TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, operation_json TEXT NOT NULL
);
CREATE TABLE note_summaries(uid TEXT PRIMARY KEY NOT NULL,status TEXT,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT,summary_json TEXT NOT NULL);
CREATE VIRTUAL TABLE note_search USING fts5(uid UNINDEXED,title,content,tokenize='trigram');
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        install_test_schema(&connection);
        connection
    }

    fn create(repository: &mut NoteRepository<'_>, uid: &str, time: i64, content: &str) {
        repository
            .create(CreateNote {
                uid: uid.into(),
                title: format!("Title {uid}"),
                content: content.into(),
                updated_at: format!("2026-09-16T00:00:{time:02}Z"),
            })
            .unwrap();
    }

    #[test]
    fn cursor_pages_are_stable_and_summaries_omit_full_body() {
        let mut connection = connection();
        let mut repository = NoteRepository::new(&mut connection);
        create(&mut repository, "a", 10, &"x".repeat(500));
        create(&mut repository, "b", 20, "body b");
        create(&mut repository, "c", 20, "body c");
        let first = repository.list(None, Some(2)).unwrap();
        assert_eq!(
            first
                .items
                .iter()
                .map(|n| n.uid.as_str())
                .collect::<Vec<_>>(),
            ["c", "b"]
        );
        assert_eq!(first.items[0].excerpt, "body c");
        let second = repository
            .list(first.next_cursor.as_deref(), Some(2))
            .unwrap();
        assert_eq!(
            second
                .items
                .iter()
                .map(|n| n.uid.as_str())
                .collect::<Vec<_>>(),
            ["a"]
        );
        assert!(second.next_cursor.is_none());
        assert_eq!(second.items[0].excerpt.len(), 180);
    }

    #[test]
    fn create_rolls_back_note_when_outbox_write_fails() {
        let mut connection = connection();
        let mut repository = NoteRepository::new(&mut connection);
        repository.connection.execute_batch("CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
        let result = repository.create(CreateNote {
            uid: "rollback".into(),
            title: "title".into(),
            content: "body".into(),
            updated_at: "2026-09-16T00:00:01Z".into(),
        });
        assert_eq!(result.unwrap_err().code, NoteRepositoryErrorCode::Database);
        assert!(matches!(
            repository.get("rollback"),
            Err(NoteRepositoryError {
                code: NoteRepositoryErrorCode::NotFound,
                ..
            })
        ));
    }

    #[test]
    fn update_detects_version_conflict_without_partial_write() {
        let mut connection = connection();
        let mut repository = NoteRepository::new(&mut connection);
        create(&mut repository, "n1", 1, "original");
        let result = repository.update(UpdateNote {
            uid: "n1".into(),
            title: "changed".into(),
            content: "changed".into(),
            updated_at: "2026-09-16T00:00:02Z".into(),
            expected_version: 9,
        });
        assert_eq!(result.unwrap_err().code, NoteRepositoryErrorCode::Conflict);
        let note = repository.get("n1").unwrap();
        assert_eq!(note.content, "original");
        assert_eq!(note.version, 1);
    }

    #[test]
    fn fts_search_returns_legacy_compatible_excerpt() {
        let mut connection = connection();
        let mut repository = NoteRepository::new(&mut connection);
        create(
            &mut repository,
            "rust",
            2,
            "Rust moves database work off the UI thread",
        );
        create(&mut repository, "other", 1, "unrelated words");
        let page = repository.search("database", Some(1), Some(10)).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].uid, "rust");
        assert_eq!(
            page.items[0].snippet,
            "Rust moves database work off the UI thread"
        );
    }

    #[test]
    fn excerpts_follow_legacy_whitespace_and_utf16_slicing() {
        assert_eq!(
            legacy_list_excerpt("line one\n\tline two"),
            "line one line two"
        );
        let prefix = "😀".repeat(61);
        let content = format!("{prefix}needle tail");
        let excerpt = legacy_search_excerpt(&content, "needle");
        assert_eq!(
            excerpt
                .chars()
                .filter(|character| *character == '😀')
                .count(),
            30
        );
        assert!(excerpt.contains("needle"));
        let punctuated = format!("{}needle tail", "`".repeat(70));
        assert_eq!(legacy_search_excerpt(&punctuated, "needle"), punctuated);
    }

    #[test]
    fn one_and_two_character_searches_use_the_mirror_text() {
        let mut connection = connection();
        let mut repository = NoteRepository::new(&mut connection);
        create(&mut repository, "cn", 2, "使用原生核心提升速度");
        create(&mut repository, "other", 1, "无关内容");

        let one = repository.search("原", Some(1), Some(10)).unwrap();
        let two = repository.search("原生", Some(1), Some(10)).unwrap();
        assert_eq!(
            one.items
                .iter()
                .map(|hit| hit.uid.as_str())
                .collect::<Vec<_>>(),
            ["cn"]
        );
        assert_eq!(
            two.items
                .iter()
                .map(|hit| hit.uid.as_str())
                .collect::<Vec<_>>(),
            ["cn"]
        );
    }

    #[test]
    fn search_reports_exact_total_and_page_metadata() {
        let mut connection = connection();
        let mut repository = NoteRepository::new(&mut connection);
        for index in 1..=5 {
            create(
                &mut repository,
                &format!("n{index}"),
                index,
                "shared database phrase",
            );
        }
        let page = repository.search("database", Some(2), Some(2)).unwrap();
        assert_eq!(
            (
                page.items.len(),
                page.total,
                page.page,
                page.size,
                page.has_more
            ),
            (2, 5, 2, 2, true)
        );
        let last = repository.search("database", Some(3), Some(2)).unwrap();
        assert_eq!((last.items.len(), last.total, last.has_more), (1, 5, false));
    }
}

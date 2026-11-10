//! Cross-domain, read-only search for the native desktop core.
//!
//! Notes use the existing trigram FTS5 table for queries of three or more
//! Unicode scalar values. One/two-character queries (and tasks/projects until
//! their FTS index is migrated) use an escaped, parameterized LIKE fallback.

use crate::search_normalization::normalize_search_query;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{cmp::Ordering, fmt};

const MAX_PAGE_SIZE: usize = 50;
const MAX_SNIPPET_CHARS: usize = 240;
const DOMAIN_CANDIDATE_LIMIT: usize = 250;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub kind: SearchKind,
    pub uid: String,
    pub title: String,
    pub snippet: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub items: Vec<SearchHit>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchKind {
    Note,
    Task,
    Project,
}

impl SearchKind {
    fn order(self) -> u8 {
        match self {
            Self::Note => 0,
            Self::Task => 1,
            Self::Project => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Cursor {
    score: u8,
    updated_at: String,
    kind: u8,
    uid: String,
}

#[derive(Debug)]
pub enum SearchError {
    Sqlite(rusqlite::Error),
    InvalidCursor,
    MissingSearchIndex,
}

impl fmt::Display for SearchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "search database error: {e}"),
            Self::InvalidCursor => f.write_str("invalid search cursor"),
            Self::MissingSearchIndex => f.write_str("note_search FTS5 index is unavailable"),
        }
    }
}
impl std::error::Error for SearchError {}
impl From<rusqlite::Error> for SearchError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

#[derive(Debug)]
struct Candidate {
    hit: SearchHit,
    score: u8,
}

pub struct SearchRepository<'a> {
    connection: &'a Connection,
}

impl<'a> SearchRepository<'a> {
    pub fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub fn search(&self, request: SearchRequest) -> Result<SearchPage, SearchError> {
        let query = normalize_search_query(&request.query);
        let limit = request.limit.unwrap_or(20).clamp(1, MAX_PAGE_SIZE as u32) as usize;
        if query.is_empty() {
            return Ok(SearchPage {
                items: vec![],
                next_cursor: None,
                has_more: false,
            });
        }
        let after = request.cursor.as_deref().map(decode_cursor).transpose()?;
        let mut candidates = Vec::new();
        self.notes(&query, &mut candidates)?;
        self.json_domain(
            SearchKind::Task,
            "tasks",
            "title",
            "description",
            &query,
            &mut candidates,
        )?;
        self.json_domain(
            SearchKind::Project,
            "projects",
            "name",
            "description",
            &query,
            &mut candidates,
        )?;
        candidates.sort_by(compare_candidates);
        candidates.dedup_by(|a, b| a.hit.kind == b.hit.kind && a.hit.uid == b.hit.uid);
        if let Some(cursor) = after {
            candidates.retain(|candidate| is_after(candidate, &cursor));
        }
        let has_more = candidates.len() > limit;
        candidates.truncate(limit);
        let next_cursor = if has_more {
            candidates.last().map(encode_candidate)
        } else {
            None
        };
        Ok(SearchPage {
            items: candidates.into_iter().map(|c| c.hit).collect(),
            next_cursor,
            has_more,
        })
    }

    fn notes(&self, query: &str, output: &mut Vec<Candidate>) -> Result<(), SearchError> {
        let long = query.chars().count() >= 3;
        let (sql, parameter) = if long {
            if !table_exists(self.connection, "note_search")? {
                return Err(SearchError::MissingSearchIndex);
            }
            ("SELECT n.uid,n.title,n.content,n.updated_at FROM note_search s JOIN notes n ON n.uid=s.uid WHERE note_search MATCH ?1 AND n.deleted=0 AND coalesce(n.status,'inbox')<>'archived' LIMIT ?2", fts_literal(query))
        } else {
            ("SELECT uid,title,content,updated_at FROM notes WHERE deleted=0 AND coalesce(status,'inbox')<>'archived' AND search_text LIKE ?1 ESCAPE '\\' LIMIT ?2", like_pattern(query))
        };
        let mut statement = self.connection.prepare(sql)?;
        let rows =
            statement.query_map(params![parameter, DOMAIN_CANDIDATE_LIMIT as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?;
        for row in rows {
            let (uid, title, body, updated) = row?;
            output.push(candidate(
                SearchKind::Note,
                uid,
                title,
                body,
                updated,
                query,
            ));
        }
        Ok(())
    }

    fn json_domain(
        &self,
        kind: SearchKind,
        table: &str,
        title_key: &str,
        body_key: &str,
        query: &str,
        output: &mut Vec<Candidate>,
    ) -> Result<(), SearchError> {
        if !table_exists(self.connection, table)? {
            return Ok(());
        }
        // Table/key identifiers are compile-time constants; all user input remains bound.
        let sql = format!("SELECT uid,coalesce(json_extract(entity_json,'$.{title_key}'),''),coalesce(json_extract(entity_json,'$.{body_key}'),''),updated_at FROM {table} WHERE deleted=0 AND (lower(coalesce(json_extract(entity_json,'$.{title_key}'),'')) LIKE ?1 ESCAPE '\\' OR lower(coalesce(json_extract(entity_json,'$.{body_key}'),'')) LIKE ?1 ESCAPE '\\') LIMIT ?2");
        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(
            params![like_pattern(query), DOMAIN_CANDIDATE_LIMIT as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )?;
        for row in rows {
            let (uid, title, body, updated) = row?;
            output.push(candidate(kind, uid, title, body, updated, query));
        }
        Ok(())
    }
}

fn candidate(
    kind: SearchKind,
    uid: String,
    title: String,
    body: String,
    updated_at: Option<String>,
    query: &str,
) -> Candidate {
    let lower_title = title.to_lowercase();
    let score = if lower_title == query {
        0
    } else if lower_title.starts_with(query) {
        1
    } else if lower_title.contains(query) {
        2
    } else {
        3
    };
    Candidate {
        hit: SearchHit {
            kind,
            uid,
            title,
            snippet: snippet(&body, query),
            updated_at,
        },
        score,
    }
}

fn compare_candidates(a: &Candidate, b: &Candidate) -> Ordering {
    a.score
        .cmp(&b.score)
        .then_with(|| {
            b.hit
                .updated_at
                .as_deref()
                .unwrap_or("")
                .cmp(a.hit.updated_at.as_deref().unwrap_or(""))
        })
        .then_with(|| a.hit.kind.order().cmp(&b.hit.kind.order()))
        .then_with(|| a.hit.uid.cmp(&b.hit.uid))
}

fn is_after(value: &Candidate, cursor: &Cursor) -> bool {
    let marker = Candidate {
        score: cursor.score,
        hit: SearchHit {
            kind: match cursor.kind {
                0 => SearchKind::Note,
                1 => SearchKind::Task,
                _ => SearchKind::Project,
            },
            uid: cursor.uid.clone(),
            title: String::new(),
            snippet: String::new(),
            updated_at: if cursor.updated_at.is_empty() {
                None
            } else {
                Some(cursor.updated_at.clone())
            },
        },
    };
    compare_candidates(value, &marker) == Ordering::Greater
}

fn snippet(body: &str, query: &str) -> String {
    let chars: Vec<char> = body.chars().collect();
    let lower = body.to_lowercase();
    let mut byte_at = lower.find(query).unwrap_or(0).min(body.len());
    while byte_at > 0 && !body.is_char_boundary(byte_at) {
        byte_at -= 1;
    }
    let char_at = body[..byte_at].chars().count();
    let start = char_at.saturating_sub(60);
    chars
        .into_iter()
        .skip(start)
        .take(MAX_SNIPPET_CHARS)
        .collect()
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
fn table_exists(connection: &Connection, name: &str) -> Result<bool, rusqlite::Error> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name=?1)",
        [name],
        |row| row.get(0),
    )
}
fn encode_candidate(value: &Candidate) -> String {
    let cursor = Cursor {
        score: value.score,
        updated_at: value.hit.updated_at.clone().unwrap_or_default(),
        kind: value.hit.kind.order(),
        uid: value.hit.uid.clone(),
    };
    serde_json::to_vec(&cursor)
        .unwrap()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn decode_cursor(value: &str) -> Result<Cursor, SearchError> {
    if value.len() % 2 != 0 || value.len() > 2048 {
        return Err(SearchError::InvalidCursor);
    }
    let bytes = (0..value.len())
        .step_by(2)
        .map(|at| {
            u8::from_str_radix(&value[at..at + 2], 16).map_err(|_| SearchError::InvalidCursor)
        })
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::from_slice(&bytes).map_err(|_| SearchError::InvalidCursor)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE notes(uid TEXT PRIMARY KEY,title TEXT,content TEXT,status TEXT,deleted INTEGER,updated_at TEXT,search_text TEXT,entity_json TEXT); CREATE VIRTUAL TABLE note_search USING fts5(uid UNINDEXED,title,content,tokenize='trigram'); CREATE TABLE tasks(uid TEXT PRIMARY KEY,completed INTEGER,due_at TEXT,updated_at TEXT,deleted INTEGER,entity_json TEXT); CREATE TABLE projects(uid TEXT PRIMARY KEY,area_uid TEXT,status TEXT,sort_order INTEGER,deleted INTEGER,updated_at TEXT,entity_json TEXT);").unwrap();
        db.execute("INSERT INTO notes VALUES('n1','Rust 性能','使用原生核心提升速度','active',0,'2026-01-03','rust 性能 使用原生核心提升速度','{}')", []).unwrap();
        db.execute(
            "INSERT INTO note_search VALUES('n1','Rust 性能','使用原生核心提升速度')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO tasks VALUES('t1',0,NULL,'2026-01-02',0,?1)",
            [r#"{"title":"性能测试","description":"测试设置页面"}"#],
        )
        .unwrap();
        db.execute(
            "INSERT INTO projects VALUES('p1','a','active',0,0,'2026-01-01',?1)",
            [r#"{"name":"生产构建","description":"Rust desktop release"}"#],
        )
        .unwrap();
        db
    }

    fn search(db: &Connection, query: &str, limit: u32, cursor: Option<String>) -> SearchPage {
        SearchRepository::new(db)
            .search(SearchRequest {
                query: query.into(),
                limit: Some(limit),
                cursor,
            })
            .unwrap()
    }

    #[test]
    fn searches_english_and_chinese_across_domains() {
        let db = database();
        assert_eq!(search(&db, "Rust", 20, None).items.len(), 2);
        assert_eq!(
            search(&db, "性能", 20, None)
                .items
                .iter()
                .map(|x| x.kind)
                .collect::<Vec<_>>(),
            vec![SearchKind::Task, SearchKind::Note]
        );
    }

    #[test]
    fn one_and_two_character_queries_use_safe_fallback() {
        let db = database();
        assert_eq!(search(&db, "原", 20, None).items[0].uid, "n1");
        assert!(search(&db, "构建", 20, None)
            .items
            .iter()
            .any(|x| x.uid == "p1"));
    }

    #[test]
    fn wildcard_quotes_and_injection_are_literals() {
        let db = database();
        for value in ["%", "_", "' OR 1=1 --", "\""] {
            assert!(search(&db, value, 20, None).items.is_empty());
        }
        assert_eq!(
            db.query_row("SELECT count(*) FROM notes", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn cursor_pagination_is_stable_and_payload_is_bounded() {
        let db = database();
        for index in 0..8 {
            db.execute(
                "INSERT INTO tasks VALUES(?1,0,NULL,?2,0,?3)",
                params![
                    format!("x{index}"),
                    format!("2025-12-{index:02}"),
                    format!(
                        r#"{{"title":"测试 {index}","description":"{}"}}"#,
                        "内容".repeat(300)
                    )
                ],
            )
            .unwrap();
        }
        let first = search(&db, "测试", 3, None);
        let second = search(&db, "测试", 3, first.next_cursor.clone());
        assert!(
            first.has_more
                && first
                    .items
                    .iter()
                    .all(|x| x.snippet.chars().count() <= MAX_SNIPPET_CHARS)
        );
        assert!(first
            .items
            .iter()
            .all(|a| second.items.iter().all(|b| a.uid != b.uid)));
        assert_eq!(first.items, search(&db, "测试", 3, None).items);
    }
}

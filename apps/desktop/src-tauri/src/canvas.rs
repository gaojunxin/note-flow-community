use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[path = "canvas/format.rs"]
mod format;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Canvas {
    pub uid: String,
    pub title: String,
    pub area_uid: Option<String>,
    pub project_uid: Option<String>,
    pub scene_data: String,
    #[serde(default)]
    pub document_data: String,
    #[serde(default = "default_canvas_type")]
    pub canvas_type: String,
    #[serde(default = "default_data_format")]
    pub data_format: String,
    #[serde(default = "default_data_version")]
    pub data_version: i64,
    #[serde(default = "default_source_mode")]
    pub source_mode: String,
    #[serde(default)]
    pub source_note_uid: Option<String>,
    pub text_index: String,
    #[serde(default)]
    pub scene_checksum: String,
    pub source_format: String,
    pub source_path: String,
    pub status: String,
    pub version: i64,
    pub deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasWrite {
    pub uid: Option<String>,
    pub title: Option<String>,
    pub area_uid: Option<String>,
    pub project_uid: Option<String>,
    pub scene_data: Option<String>,
    pub document_data: Option<String>,
    pub canvas_type: Option<String>,
    pub data_format: Option<String>,
    pub data_version: Option<i64>,
    pub source_mode: Option<String>,
    pub source_note_uid: Option<String>,
    pub source_format: Option<String>,
    pub source_path: Option<String>,
    pub status: Option<String>,
    pub version: Option<i64>,
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSnapshot {
    pub version: i64,
    pub scene_checksum: String,
    pub created_at: String,
}

pub struct CanvasRepository<'a> {
    db: &'a mut Connection,
}

impl<'a> CanvasRepository<'a> {
    pub fn new(db: &'a mut Connection) -> Self {
        Self { db }
    }

    pub fn list(&self, query: Option<&str>) -> Result<Vec<Canvas>, String> {
        let pattern = format!("%{}%", query.unwrap_or("").trim());
        let mut statement = self.db.prepare("SELECT entity_json FROM canvases WHERE deleted=0 AND (?1='%%' OR title LIKE ?1 OR text_index LIKE ?1) ORDER BY updated_at DESC").map_err(database)?;
        let rows = statement
            .query_map([pattern], |row| row.get::<_, String>(0))
            .map_err(database)?;
        rows.map(|row| {
            row.map_err(database).and_then(|json| {
                serde_json::from_str(&json)
                    .map(normalize_canvas)
                    .map_err(database)
            })
        })
        .collect()
    }

    pub fn create(&mut self, input: CanvasWrite) -> Result<Canvas, String> {
        let canvas = build_canvas(input)?;
        let transaction = self.db.transaction().map_err(database)?;
        let exists: i64 = transaction
            .query_row(
                "SELECT count(*) FROM canvases WHERE uid=?1",
                [&canvas.uid],
                |row| row.get(0),
            )
            .map_err(database)?;
        if exists > 0 {
            return Err("conflict: canvas uid already exists".into());
        }
        write(&transaction, &canvas)?;
        snapshot(&transaction, &canvas)?;
        enqueue(&transaction, &canvas, "create", 0)?;
        transaction.commit().map_err(database)?;
        Ok(canvas)
    }

    pub fn create_many(&mut self, inputs: Vec<CanvasWrite>) -> Result<Vec<Canvas>, String> {
        if inputs.is_empty() || inputs.len() > 1_000 {
            return Err("invalid: canvas batch size must be 1..1000".into());
        }
        let canvases = inputs
            .into_iter()
            .map(build_canvas)
            .collect::<Result<Vec<_>, _>>()?;
        let transaction = self.db.transaction().map_err(database)?;
        for canvas in &canvases {
            let exists: i64 = transaction
                .query_row(
                    "SELECT count(*) FROM canvases WHERE uid=?1",
                    [&canvas.uid],
                    |row| row.get(0),
                )
                .map_err(database)?;
            if exists > 0 {
                return Err(format!("conflict: canvas {} already exists", canvas.uid));
            }
            write(&transaction, canvas)?;
            snapshot(&transaction, canvas)?;
            enqueue(&transaction, canvas, "create", 0)?;
        }
        transaction.commit().map_err(database)?;
        Ok(canvases)
    }

    pub fn update(&mut self, input: CanvasWrite) -> Result<Canvas, String> {
        let uid = input
            .uid
            .clone()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "invalid: canvas uid is required".to_string())?;
        let expected = input
            .version
            .ok_or_else(|| "invalid: canvas version is required".to_string())?;
        let transaction = self.db.transaction().map_err(database)?;
        let json = transaction
            .query_row(
                "SELECT entity_json FROM canvases WHERE uid=?1 AND deleted=0",
                [&uid],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database)?
            .ok_or_else(|| "not-found: canvas was not found".to_string())?;
        let current = normalize_canvas(serde_json::from_str(&json).map_err(database)?);
        if current.version != expected {
            return Err(format!(
                "conflict: expected version {expected}, current version {}",
                current.version
            ));
        }
        let canvas_type = input.canvas_type.unwrap_or(current.canvas_type);
        let data_format = input.data_format.unwrap_or(current.data_format);
        let data_version = input.data_version.unwrap_or(current.data_version);
        let document_data = input
            .document_data
            .or(input.scene_data)
            .unwrap_or(current.document_data);
        let scene_data = if canvas_type == "excalidraw" {
            document_data.clone()
        } else {
            current.scene_data
        };
        let canvas = Canvas {
            uid,
            title: input
                .title
                .map(|value| clean_title(Some(value)))
                .unwrap_or(current.title),
            area_uid: input.area_uid.or(current.area_uid),
            project_uid: input.project_uid.or(current.project_uid),
            text_index: format::text_index(
                &canvas_type,
                &data_format,
                &data_version,
                &document_data,
            )?,
            scene_checksum: checksum(&document_data),
            scene_data,
            document_data,
            canvas_type,
            data_format,
            data_version,
            source_mode: input.source_mode.unwrap_or(current.source_mode),
            source_note_uid: input.source_note_uid.or(current.source_note_uid),
            source_format: input.source_format.unwrap_or(current.source_format),
            source_path: input.source_path.unwrap_or(current.source_path),
            status: input.status.unwrap_or(current.status),
            version: current.version + 1,
            deleted: false,
            created_at: current.created_at,
            updated_at: Utc::now().to_rfc3339(),
        };
        validate_metadata(&canvas)?;
        write(&transaction, &canvas)?;
        snapshot(&transaction, &canvas)?;
        enqueue(&transaction, &canvas, "update", expected)?;
        transaction.execute("DELETE FROM canvas_snapshots WHERE canvas_uid=?1 AND id NOT IN (SELECT id FROM canvas_snapshots WHERE canvas_uid=?1 ORDER BY version DESC LIMIT 30)", [&canvas.uid]).map_err(database)?;
        transaction.commit().map_err(database)?;
        Ok(canvas)
    }

    pub fn delete(&mut self, uid: &str, expected_version: i64) -> Result<Canvas, String> {
        let json = self
            .db
            .query_row(
                "SELECT entity_json FROM canvases WHERE uid=?1 AND deleted=0",
                [uid],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database)?
            .ok_or_else(|| "not-found: canvas was not found".to_string())?;
        let mut canvas = normalize_canvas(serde_json::from_str(&json).map_err(database)?);
        if canvas.version != expected_version {
            return Err("conflict: canvas changed before deletion".into());
        }
        canvas.deleted = true;
        canvas.version += 1;
        canvas.updated_at = Utc::now().to_rfc3339();
        let transaction = self.db.transaction().map_err(database)?;
        let pending = pending_canvas_operation(&transaction, uid)?;
        if pending
            .as_ref()
            .and_then(|value| value.get("action"))
            .and_then(Value::as_str)
            == Some("create")
        {
            if let Some(operation_id) = pending.and_then(|value| {
                value
                    .get("operationId")
                    .and_then(Value::as_str)
                    .map(String::from)
            }) {
                transaction
                    .execute("DELETE FROM outbox WHERE operation_id=?1", [operation_id])
                    .map_err(database)?;
            }
            transaction
                .execute("DELETE FROM canvas_snapshots WHERE canvas_uid=?1", [uid])
                .map_err(database)?;
            transaction
                .execute("DELETE FROM canvases WHERE uid=?1", [uid])
                .map_err(database)?;
            transaction.commit().map_err(database)?;
            return Ok(canvas);
        }
        write(&transaction, &canvas)?;
        enqueue(&transaction, &canvas, "delete", expected_version)?;
        transaction.commit().map_err(database)?;
        Ok(canvas)
    }

    pub fn snapshots(&self, uid: &str) -> Result<Vec<CanvasSnapshot>, String> {
        let mut statement = self.db.prepare("SELECT version,scene_checksum,created_at FROM canvas_snapshots WHERE canvas_uid=?1 ORDER BY version DESC LIMIT 30").map_err(database)?;
        let rows = statement
            .query_map([uid], |row| {
                Ok(CanvasSnapshot {
                    version: row.get(0)?,
                    scene_checksum: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })
            .map_err(database)?;
        rows.map(|row| row.map_err(database)).collect()
    }

    pub fn restore(
        &mut self,
        uid: &str,
        snapshot_version: i64,
        expected_version: i64,
    ) -> Result<Canvas, String> {
        let scene_data = self
            .db
            .query_row(
                "SELECT scene_data FROM canvas_snapshots WHERE canvas_uid=?1 AND version=?2",
                params![uid, snapshot_version],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database)?
            .ok_or_else(|| "not-found: canvas snapshot was not found".to_string())?;
        let json = self
            .db
            .query_row(
                "SELECT entity_json FROM canvases WHERE uid=?1 AND deleted=0",
                [uid],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database)?
            .ok_or_else(|| "not-found: canvas was not found".to_string())?;
        let current = normalize_canvas(serde_json::from_str(&json).map_err(database)?);
        if current.version != expected_version {
            return Err("conflict: canvas changed before snapshot restore".into());
        }
        self.update(CanvasWrite {
            uid: Some(uid.into()),
            title: None,
            area_uid: None,
            project_uid: None,
            scene_data: None,
            document_data: Some(scene_data),
            canvas_type: None,
            data_format: None,
            data_version: None,
            source_mode: None,
            source_note_uid: None,
            source_format: None,
            source_path: None,
            status: None,
            version: Some(expected_version),
            created_at: None,
        })
    }
}

fn build_canvas(input: CanvasWrite) -> Result<Canvas, String> {
    let now = Utc::now().to_rfc3339();
    let canvas_type = input.canvas_type.unwrap_or_else(default_canvas_type);
    let data_format = input
        .data_format
        .unwrap_or_else(|| default_format_for(&canvas_type).into());
    let data_version = input.data_version.unwrap_or_else(default_data_version);
    let document_data = match input.document_data.or(input.scene_data) {
        Some(value) => value,
        None => format::empty_document(&canvas_type, &data_format, &data_version)?,
    };
    let scene_data = if canvas_type == "excalidraw" {
        document_data.clone()
    } else {
        String::new()
    };
    let canvas = Canvas {
        uid: input.uid.unwrap_or_else(|| Uuid::new_v4().to_string()),
        title: clean_title(input.title),
        area_uid: input.area_uid,
        project_uid: input.project_uid,
        text_index: format::text_index(&canvas_type, &data_format, &data_version, &document_data)?,
        scene_checksum: checksum(&document_data),
        scene_data,
        document_data,
        canvas_type,
        data_format,
        data_version,
        source_mode: input.source_mode.unwrap_or_else(default_source_mode),
        source_note_uid: input.source_note_uid,
        source_format: input.source_format.unwrap_or_else(|| "native".into()),
        source_path: input.source_path.unwrap_or_default(),
        status: input.status.unwrap_or_else(|| "active".into()),
        version: 0,
        deleted: false,
        created_at: input.created_at.unwrap_or_else(|| now.clone()),
        updated_at: now,
    };
    validate_metadata(&canvas)?;
    Ok(canvas)
}

fn clean_title(value: Option<String>) -> String {
    let title: String = value.unwrap_or_default().trim().chars().take(240).collect();
    if title.is_empty() {
        "未命名画布".into()
    } else {
        title
    }
}

fn validate_metadata(canvas: &Canvas) -> Result<(), String> {
    if canvas.uid.len() > 128
        || canvas.title.len() > 720
        || !matches!(canvas.status.as_str(), "active" | "archived")
    {
        return Err("invalid: invalid canvas metadata".into());
    }
    if canvas.document_data.len() > format::MAX_DOCUMENT_BYTES {
        return Err("invalid: canvas document exceeds 50 MiB".into());
    }
    if !matches!(canvas.source_mode.as_str(), "independent" | "linked") {
        return Err("invalid: invalid canvas source mode".into());
    }
    if canvas.source_mode == "linked" && canvas.source_note_uid.as_deref().unwrap_or("").is_empty()
    {
        return Err("invalid: linked canvas requires source note uid".into());
    }
    Ok(())
}

fn checksum(scene: &str) -> String {
    format!("{:x}", Sha256::digest(scene.as_bytes()))
}
fn default_canvas_type() -> String {
    "excalidraw".into()
}
fn default_data_format() -> String {
    "excalidraw-json".into()
}
fn default_data_version() -> i64 {
    1
}
fn default_source_mode() -> String {
    "independent".into()
}
fn default_format_for(canvas_type: &str) -> &'static str {
    match canvas_type {
        "mindmap" => "noteflow-mindmap-v1",
        "flowchart" => "mermaid-text",
        "knowledge_graph" => "noteflow-knowledge-graph-view-v1",
        "diagrams" => "drawio-xml",
        _ => "excalidraw-json",
    }
}
fn normalize_canvas(mut canvas: Canvas) -> Canvas {
    if canvas.canvas_type.is_empty() {
        canvas.canvas_type = default_canvas_type();
    }
    if canvas.data_format.is_empty() {
        canvas.data_format = default_format_for(&canvas.canvas_type).into();
    }
    if canvas.data_version < 1 {
        canvas.data_version = default_data_version();
    }
    if canvas.source_mode.is_empty() {
        canvas.source_mode = default_source_mode();
    }
    if canvas.document_data.is_empty() {
        canvas.document_data = canvas.scene_data.clone();
    }
    canvas
}
fn database(error: impl std::fmt::Display) -> String {
    format!("database: {error}")
}

fn write(db: &Connection, canvas: &Canvas) -> Result<(), String> {
    let json = serde_json::to_string(canvas).map_err(database)?;
    db.execute("INSERT INTO canvases(uid,title,area_uid,project_uid,scene_data,text_index,source_format,source_path,status,version,deleted,created_at,updated_at,entity_json,canvas_type,data_format,data_version,source_mode,source_note_uid,document_data) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20) ON CONFLICT(uid) DO UPDATE SET title=excluded.title,area_uid=excluded.area_uid,project_uid=excluded.project_uid,scene_data=excluded.scene_data,text_index=excluded.text_index,source_format=excluded.source_format,source_path=excluded.source_path,status=excluded.status,version=excluded.version,deleted=excluded.deleted,updated_at=excluded.updated_at,entity_json=excluded.entity_json,canvas_type=excluded.canvas_type,data_format=excluded.data_format,data_version=excluded.data_version,source_mode=excluded.source_mode,source_note_uid=excluded.source_note_uid,document_data=excluded.document_data", params![canvas.uid,canvas.title,canvas.area_uid,canvas.project_uid,canvas.document_data,canvas.text_index,canvas.source_format,canvas.source_path,canvas.status,canvas.version,canvas.deleted as i64,canvas.created_at,canvas.updated_at,json,canvas.canvas_type,canvas.data_format,canvas.data_version,canvas.source_mode,canvas.source_note_uid,canvas.document_data]).map_err(database)?;
    Ok(())
}
fn snapshot(db: &Connection, canvas: &Canvas) -> Result<(), String> {
    db.execute("INSERT OR REPLACE INTO canvas_snapshots(canvas_uid,version,scene_data,scene_checksum,created_at) VALUES(?1,?2,?3,?4,?5)", params![canvas.uid,canvas.version,canvas.document_data,canvas.scene_checksum,canvas.updated_at]).map_err(database)?;
    Ok(())
}

fn pending_canvas_operation(db: &Connection, uid: &str) -> Result<Option<Value>, String> {
    let rows = db.prepare("SELECT operation_json FROM outbox WHERE entity_uid=?1 AND status='pending' ORDER BY created_at").map_err(database)?.query_map([uid], |row| row.get::<_,String>(0)).map_err(database)?.collect::<Result<Vec<_>,_>>().map_err(database)?;
    for row in rows {
        let value: Value = serde_json::from_str(&row).map_err(database)?;
        if value.get("entityType").and_then(Value::as_str) == Some("canvas")
            && value.get("sent").and_then(Value::as_bool) != Some(true)
        {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

fn enqueue(
    db: &Connection,
    canvas: &Canvas,
    action: &str,
    base_version: i64,
) -> Result<(), String> {
    let failed_create: i64 = db.query_row("SELECT count(*) FROM outbox WHERE entity_uid=?1 AND status='failed' AND json_extract(operation_json,'$.entityType')='canvas' AND json_extract(operation_json,'$.action')='create'",[&canvas.uid],|row|row.get(0)).map_err(database)?;
    db.execute("DELETE FROM outbox WHERE entity_uid=?1 AND status='failed' AND json_extract(operation_json,'$.entityType')='canvas'",[&canvas.uid]).map_err(database)?;
    let prior = pending_canvas_operation(db, &canvas.uid)?;
    let operation_id = prior
        .as_ref()
        .and_then(|value| value.get("operationId"))
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let created_at = prior
        .as_ref()
        .and_then(|value| value.get("createdAt"))
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let final_action = if failed_create > 0
        || prior
            .as_ref()
            .and_then(|value| value.get("action"))
            .and_then(Value::as_str)
            == Some("create")
    {
        "create"
    } else {
        action
    };
    let final_base = if failed_create > 0 {
        0
    } else {
        prior
            .as_ref()
            .and_then(|value| value.get("baseVersion"))
            .and_then(Value::as_i64)
            .unwrap_or(base_version)
    };
    let payload = if final_action == "delete" {
        Value::Null
    } else {
        serde_json::to_value(canvas).map_err(database)?
    };
    let operation = serde_json::json!({"operationId":operation_id,"entityType":"canvas","entityUid":canvas.uid,"action":final_action,"baseVersion":final_base,"payload":payload,"status":"pending","createdAt":created_at,"attempts":0});
    db.execute("INSERT OR REPLACE INTO outbox(operation_id,entity_uid,status,created_at,operation_json) VALUES(?1,?2,'pending',?3,?4)",params![operation_id,canvas.uid,created_at,operation.to_string()]).map_err(database)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE canvases(uid TEXT PRIMARY KEY,title TEXT NOT NULL,area_uid TEXT,project_uid TEXT,scene_data TEXT NOT NULL,text_index TEXT NOT NULL,source_format TEXT,source_path TEXT,status TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,entity_json TEXT NOT NULL,canvas_type TEXT NOT NULL DEFAULT 'excalidraw',data_format TEXT NOT NULL DEFAULT 'excalidraw-json',data_version INTEGER NOT NULL DEFAULT 1,source_mode TEXT NOT NULL DEFAULT 'independent',source_note_uid TEXT,document_data TEXT);CREATE TABLE canvas_snapshots(id INTEGER PRIMARY KEY,canvas_uid TEXT,version INTEGER,scene_data TEXT,scene_checksum TEXT,created_at TEXT,UNIQUE(canvas_uid,version));CREATE TABLE outbox(operation_id TEXT PRIMARY KEY,entity_uid TEXT,status TEXT,created_at TEXT,operation_json TEXT);").unwrap();
        db
    }
    #[test]
    fn sent_canvas_operations_are_never_coalesced_or_cancelled() {
        let mut db = database();
        let input: CanvasWrite =
            serde_json::from_value(serde_json::json!({"uid":"race","title":"original"})).unwrap();
        let canvas = CanvasRepository::new(&mut db).create(input).unwrap();
        let original: String = db
            .query_row("SELECT operation_json FROM outbox", [], |r| r.get(0))
            .unwrap();
        let mut sent: Value = serde_json::from_str(&original).unwrap();
        sent["sent"] = Value::Bool(true);
        db.execute("UPDATE outbox SET operation_json=?1", [sent.to_string()])
            .unwrap();
        let mut changed = canvas.clone();
        changed.title = "newer".into();
        enqueue(&db, &changed, "update", 0).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM outbox", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        let preserved: String = db
            .query_row(
                "SELECT operation_json FROM outbox WHERE operation_id=?1",
                [sent["operationId"].as_str().unwrap()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&preserved).unwrap(), sent);
        db.execute(
            "DELETE FROM outbox WHERE operation_id<>?1",
            [sent["operationId"].as_str().unwrap()],
        )
        .unwrap();
        CanvasRepository::new(&mut db)
            .delete("race", canvas.version)
            .unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM outbox", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            db.query_row("SELECT deleted FROM canvases WHERE uid='race'", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            1
        );
    }
    #[test]
    fn validates_indexes_versions_and_snapshots() {
        let mut db = database();
        let mut repo = CanvasRepository::new(&mut db);
        let created = repo
            .create(CanvasWrite {
                uid: Some("c1".into()),
                title: Some(" Test ".into()),
                area_uid: None,
                project_uid: None,
                scene_data: Some(
                    r#"{"type":"excalidraw","elements":[{"type":"text","text":"hello"}]}"#.into(),
                ),
                document_data: None,
                canvas_type: None,
                data_format: None,
                data_version: None,
                source_mode: None,
                source_note_uid: None,
                source_format: None,
                source_path: None,
                status: None,
                version: None,
                created_at: None,
            })
            .unwrap();
        assert_eq!(created.text_index, "hello");
        assert_eq!(created.scene_checksum.len(), 64);
        let updated = repo
            .update(CanvasWrite {
                uid: Some(created.uid),
                title: Some("Next".into()),
                area_uid: None,
                project_uid: None,
                scene_data: None,
                document_data: None,
                canvas_type: None,
                data_format: None,
                data_version: None,
                source_mode: None,
                source_note_uid: None,
                source_format: None,
                source_path: None,
                status: None,
                version: Some(0),
                created_at: None,
            })
            .unwrap();
        assert_eq!(updated.version, 1);
        assert!(repo
            .update(CanvasWrite {
                uid: Some("c1".into()),
                title: None,
                area_uid: None,
                project_uid: None,
                scene_data: None,
                document_data: None,
                canvas_type: None,
                data_format: None,
                data_version: None,
                source_mode: None,
                source_note_uid: None,
                source_format: None,
                source_path: None,
                status: None,
                version: Some(0),
                created_at: None
            })
            .unwrap_err()
            .starts_with("conflict:"));
        drop(repo);
        assert_eq!(
            db.query_row("SELECT count(*) FROM canvas_snapshots", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        let mut repo = CanvasRepository::new(&mut db);
        assert_eq!(repo.snapshots("c1").unwrap().len(), 2);
        let restored = repo.restore("c1", 0, 1).unwrap();
        assert_eq!(restored.version, 2);
        assert_eq!(restored.text_index, "hello");
    }
    #[test]
    fn rejects_non_excalidraw_json() {
        let mut db = database();
        let error = CanvasRepository::new(&mut db)
            .create(CanvasWrite {
                uid: None,
                title: None,
                area_uid: None,
                project_uid: None,
                scene_data: Some("{}".into()),
                document_data: None,
                canvas_type: None,
                data_format: None,
                data_version: None,
                source_mode: None,
                source_note_uid: None,
                source_format: None,
                source_path: None,
                status: None,
                version: None,
                created_at: None,
            })
            .unwrap_err();
        assert!(error.starts_with("invalid:"))
    }
    #[test]
    fn batch_create_is_atomic() {
        let mut db = database();
        let input = |uid: &str, scene: &str| CanvasWrite {
            uid: Some(uid.into()),
            title: None,
            area_uid: None,
            project_uid: None,
            scene_data: Some(scene.into()),
            document_data: None,
            canvas_type: None,
            data_format: None,
            data_version: None,
            source_mode: None,
            source_note_uid: None,
            source_format: None,
            source_path: None,
            status: None,
            version: None,
            created_at: None,
        };
        let result = CanvasRepository::new(&mut db).create_many(vec![
            input("good", r#"{"type":"excalidraw","elements":[]}"#),
            input("bad", "{}"),
        ]);
        assert!(result.is_err());
        assert_eq!(
            db.query_row("SELECT count(*) FROM canvases", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn defaults_legacy_entity_to_excalidraw_contract() {
        let value = serde_json::json!({
            "uid":"legacy", "title":"Legacy", "areaUid":null, "projectUid":null,
            "sceneData":"{\"type\":\"excalidraw\",\"elements\":[]}", "textIndex":"",
            "sourceFormat":"native", "sourcePath":"", "status":"active", "version":0,
            "deleted":false, "createdAt":"now", "updatedAt":"now"
        });
        let canvas = normalize_canvas(serde_json::from_value(value).unwrap());
        assert_eq!(canvas.canvas_type, "excalidraw");
        assert_eq!(canvas.data_format, "excalidraw-json");
        assert_eq!(canvas.data_version, 1);
        assert_eq!(canvas.document_data, canvas.scene_data);
    }

    #[test]
    fn creates_linked_mindmap_and_mermaid_documents() {
        let mut db = database();
        let mindmap = CanvasRepository::new(&mut db)
            .create(CanvasWrite {
                uid: Some("mindmap".into()),
                title: None,
                area_uid: None,
                project_uid: None,
                scene_data: None,
                document_data: Some(r#"{"nodes":{},"collapsed":[],"viewport":{}}"#.into()),
                canvas_type: Some("mindmap".into()),
                data_format: Some("noteflow-mindmap-view-v1".into()),
                data_version: Some(1),
                source_mode: Some("linked".into()),
                source_note_uid: Some("note-1".into()),
                source_format: None,
                source_path: None,
                status: None,
                version: None,
                created_at: None,
            })
            .unwrap();
        assert_eq!(mindmap.canvas_type, "mindmap");
        assert!(mindmap.scene_data.is_empty());

        let mermaid = CanvasRepository::new(&mut db)
            .create(CanvasWrite {
                uid: Some("flow".into()),
                title: None,
                area_uid: None,
                project_uid: None,
                scene_data: None,
                document_data: Some("flowchart LR\nA-->B".into()),
                canvas_type: Some("flowchart".into()),
                data_format: Some("mermaid-text".into()),
                data_version: Some(1),
                source_mode: None,
                source_note_uid: None,
                source_format: None,
                source_path: None,
                status: None,
                version: None,
                created_at: None,
            })
            .unwrap();
        assert_eq!(mermaid.text_index, "flowchart LR A-->B");
    }
}

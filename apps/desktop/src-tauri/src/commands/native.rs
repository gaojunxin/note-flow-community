//! 原生命令调度：数据库actor的锁等待和结果接收经异步端口进入阻塞线程，避免占住窗口线程。
use crate::{
    app_core::{AppCore, CoreError, CoreErrorCode, RequestContext},
    canvas::{Canvas, CanvasRepository, CanvasWrite},
    notes::{NoteRepository, NoteRepositoryError, NoteRepositoryErrorCode},
    search::{SearchError, SearchPage, SearchRepository, SearchRequest as RepositorySearchRequest},
    tasks::TasksRepository,
    workspace::{Page, RepositoryError, WorkspaceRepository},
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageRequest {
    #[serde(flatten)]
    context: RequestContext,
    cursor: Option<String>,
    limit: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityRequest {
    #[serde(flatten)]
    context: RequestContext,
    uid: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    #[serde(flatten)]
    context: RequestContext,
    query: String,
    cursor: Option<String>,
    limit: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotesSearchRequest {
    #[serde(flatten)]
    context: RequestContext,
    query: String,
    page: Option<u32>,
    size: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasListRequest {
    #[serde(flatten)]
    context: RequestContext,
    query: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasWriteRequest {
    #[serde(flatten)]
    context: RequestContext,
    canvas: CanvasWrite,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasBatchWriteRequest {
    #[serde(flatten)]
    context: RequestContext,
    canvases: Vec<CanvasWrite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasDeleteRequest {
    #[serde(flatten)]
    context: RequestContext,
    uid: String,
    expected_version: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasRestoreRequest {
    #[serde(flatten)]
    context: RequestContext,
    uid: String,
    snapshot_version: i64,
    expected_version: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectPageRequest {
    #[serde(flatten)]
    context: RequestContext,
    area_uid: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePage<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
    has_more: bool,
}

impl<T> From<Page<T>> for NativePage<T> {
    fn from(page: Page<T>) -> Self {
        let has_more = page.next_cursor.is_some();
        Self {
            items: page.items,
            next_cursor: page.next_cursor,
            has_more,
        }
    }
}

#[tauri::command]
pub async fn native_notes_list(
    request: PageRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<NativePage<crate::notes::NoteSummary>, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        let page = NoteRepository::new(db)
            .list(request.cursor.as_deref(), request.limit)
            .map_err(|error| note_error(&request_id, error))?;
        let has_more = page.next_cursor.is_some();
        Ok(NativePage {
            items: page.items,
            next_cursor: page.next_cursor,
            has_more,
        })
    }).await
}

#[tauri::command]
pub async fn native_notes_get(
    request: EntityRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<crate::notes::NoteDetail, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        NoteRepository::new(db)
            .get(&request.uid)
            .map_err(|error| note_error(&request_id, error))
    }).await
}

#[tauri::command]
pub async fn native_notes_search(
    request: NotesSearchRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<crate::notes::NoteSearchPage, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        NoteRepository::new(db)
            .search(&request.query, request.page, request.size)
            .map_err(|error| note_error(&request_id, error))
    }).await
}

#[tauri::command]
pub async fn native_tasks_list(
    request: PageRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<NativePage<serde_json::Value>, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        TasksRepository::new(db)
            .list_contract(
                request.cursor.as_deref(),
                request.limit.unwrap_or(50) as usize,
            )
            .map(NativePage::from)
            .map_err(|error| repository_error(&request_id, error))
    }).await
}

#[tauri::command]
pub async fn native_workspace_list_areas(
    request: PageRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<NativePage<serde_json::Value>, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        WorkspaceRepository::new(db)
            .list_areas_contract(
                request.cursor.as_deref(),
                request.limit.unwrap_or(50) as usize,
            )
            .map(NativePage::from)
            .map_err(|error| repository_error(&request_id, error))
    }).await
}

#[tauri::command]
pub async fn native_workspace_list_projects(
    request: ProjectPageRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<NativePage<serde_json::Value>, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        WorkspaceRepository::new(db)
            .list_projects_contract(
                request.area_uid.as_deref(),
                request.cursor.as_deref(),
                request.limit.unwrap_or(50) as usize,
            )
            .map(NativePage::from)
            .map_err(|error| repository_error(&request_id, error))
    }).await
}

#[tauri::command]
pub async fn native_search(
    request: SearchRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<SearchPage, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        SearchRepository::new(db)
            .search(RepositorySearchRequest {
                query: request.query,
                limit: request.limit,
                cursor: request.cursor,
            })
            .map_err(|error| search_error(&request_id, error))
    }).await
}

#[tauri::command]
pub async fn native_canvases_list(
    request: CanvasListRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<Vec<Canvas>, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        CanvasRepository::new(db)
            .list(request.query.as_deref())
            .map_err(|message| canvas_error(&request_id, message))
    }).await
}

#[tauri::command]
pub async fn native_canvas_create(
    request: CanvasWriteRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<Canvas, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        CanvasRepository::new(db)
            .create(request.canvas)
            .map_err(|message| canvas_error(&request_id, message))
    }).await
}

#[tauri::command]
pub async fn native_canvases_create_batch(
    request: CanvasBatchWriteRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<Vec<Canvas>, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        CanvasRepository::new(db)
            .create_many(request.canvases)
            .map_err(|message| canvas_error(&request_id, message))
    }).await
}

#[tauri::command]
pub async fn native_canvas_update(
    request: CanvasWriteRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<Canvas, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        CanvasRepository::new(db)
            .update(request.canvas)
            .map_err(|message| canvas_error(&request_id, message))
    }).await
}

#[tauri::command]
pub async fn native_canvas_delete(
    request: CanvasDeleteRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<Canvas, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        CanvasRepository::new(db)
            .delete(&request.uid, request.expected_version)
            .map_err(|message| canvas_error(&request_id, message))
    }).await
}

#[tauri::command]
pub async fn native_canvas_snapshots(
    request: EntityRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<Vec<crate::canvas::CanvasSnapshot>, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        CanvasRepository::new(db)
            .snapshots(&request.uid)
            .map_err(|message| canvas_error(&request_id, message))
    }).await
}

#[tauri::command]
pub async fn native_canvas_restore(
    request: CanvasRestoreRequest,
    core: tauri::State<'_, AppCore>,
) -> Result<Canvas, CoreError> {
    let context = request.context;
    let request_id = context.request_id.clone();
    core.with_profile_db_async(&context, move |db| {
        CanvasRepository::new(db)
            .restore(
                &request.uid,
                request.snapshot_version,
                request.expected_version,
            )
            .map_err(|message| canvas_error(&request_id, message))
    }).await
}

fn canvas_error(request_id: &str, message: String) -> CoreError {
    let code = if message.starts_with("conflict:") {
        CoreErrorCode::Conflict
    } else if message.starts_with("not-found:") {
        CoreErrorCode::NotFound
    } else if message.starts_with("invalid:") {
        CoreErrorCode::InvalidArgument
    } else {
        CoreErrorCode::Database
    };
    let retryable = code == CoreErrorCode::Database;
    CoreError::new(
        code,
        message
            .split_once(':')
            .map(|(_, value)| value.trim())
            .unwrap_or(&message),
        retryable,
        request_id,
    )
}

fn note_error(request_id: &str, error: NoteRepositoryError) -> CoreError {
    let code = match error.code {
        NoteRepositoryErrorCode::InvalidArgument => CoreErrorCode::InvalidArgument,
        NoteRepositoryErrorCode::NotFound => CoreErrorCode::NotFound,
        NoteRepositoryErrorCode::Conflict => CoreErrorCode::Conflict,
        NoteRepositoryErrorCode::Database => CoreErrorCode::Database,
    };
    CoreError::new(code, error.message, error.retryable, request_id)
}

fn repository_error(request_id: &str, error: RepositoryError) -> CoreError {
    let (code, message) = match error {
        RepositoryError::InvalidCursor => {
            (CoreErrorCode::InvalidArgument, "invalid pagination cursor")
        }
        RepositoryError::MissingRelation { .. } | RepositoryError::NotFound { .. } => {
            (CoreErrorCode::NotFound, "related entity was not found")
        }
        RepositoryError::VersionConflict { .. } => {
            (CoreErrorCode::Conflict, "entity version conflict")
        }
        RepositoryError::Sqlite(_) | RepositoryError::Json(_) => {
            (CoreErrorCode::Database, "database operation failed")
        }
    };
    let retryable = code == CoreErrorCode::Database;
    CoreError::new(code, message, retryable, request_id)
}

fn search_error(request_id: &str, error: SearchError) -> CoreError {
    let (code, message) = match error {
        SearchError::InvalidCursor => (CoreErrorCode::InvalidArgument, "invalid search cursor"),
        SearchError::MissingSearchIndex => (CoreErrorCode::Database, "search index is unavailable"),
        SearchError::Sqlite(_) => (CoreErrorCode::Database, "search database operation failed"),
    };
    let retryable = code == CoreErrorCode::Database;
    CoreError::new(code, message, retryable, request_id)
}

/// 业务聚合快照只允许已接入统一仓储的业务命名空间；profile由AppCore校验并绑定真实数据库。
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct BusinessStateRequest {
 #[serde(flatten)] context: RequestContext,
 key: String,
 expected: Option<String>,
 value: Option<String>,
}
fn valid_business_key(key:&str)->bool {key.len()<=1024 && ["notifications:","knowledge:","folder-transfer:","focus-checkpoint:","task-lists:","library-cache:","learning-cache:","business-recovery:"].iter().any(|prefix|key.starts_with(prefix))}
#[tauri::command]
pub async fn native_business_state_read(request:BusinessStateRequest,core:tauri::State<'_,AppCore>)->Result<Option<String>,CoreError>{
 let context=request.context;let id=context.request_id.clone();
 if !valid_business_key(&request.key){return Err(CoreError::invalid(&id,"业务存储键无效"));}
 core.with_profile_db_async(&context,move|db|crate::local_state::read(db,&request.key).map_err(|_|CoreError::new(CoreErrorCode::Database,"读取本机业务状态失败",true,&id))).await
}
/// 只读业务前缀快照供队列检查；复用相同profile和命名空间校验，不执行迁移。
#[tauri::command]
pub async fn native_business_state_list(request:BusinessStateRequest,core:tauri::State<'_,AppCore>)->Result<Vec<(String,String)>,CoreError>{
 let context=request.context;let id=context.request_id.clone();
 if !valid_business_key(&request.key){return Err(CoreError::invalid(&id,"业务存储前缀无效"));}
 core.with_profile_db_async(&context,move|db|crate::local_state::list(db,&request.key).map_err(|_|CoreError::new(CoreErrorCode::Database,"读取本机业务状态失败或超过检查上限",true,&id))).await
}
/// 一次IPC完成比较和提交；冲突时保留双方，不盲目重试覆盖。
#[tauri::command]
pub async fn native_business_state_write(request:BusinessStateRequest,core:tauri::State<'_,AppCore>)->Result<(),CoreError>{
 let context=request.context;let id=context.request_id.clone();
 let value=request.value.ok_or_else(||CoreError::invalid(&id,"缺少业务状态"))?;
 if !valid_business_key(&request.key)||value.len()>32*1024*1024||serde_json::from_str::<serde_json::Value>(&value).is_err(){return Err(CoreError::invalid(&id,"业务状态格式或大小无效"));}
 core.with_profile_db_async(&context,move|db|{let written=crate::local_state::write(db,&request.key,request.expected.as_deref(),&value).map_err(|_|CoreError::new(CoreErrorCode::Database,"保存本机业务状态失败",true,&id))?;if !written{return Err(CoreError::new(CoreErrorCode::Conflict,"本机状态已由另一窗口更新，请重新加载",true,&id));}Ok(())}).await
}

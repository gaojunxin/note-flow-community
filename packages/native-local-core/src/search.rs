use serde::{Deserialize, Serialize};
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;


pub const SEARCH_QUERY_MAX_LENGTH: usize = 100;
pub const SEARCH_PAGE_MAX_SIZE: usize = 50;

/// 统一全角/兼容字符、大小写和Markdown分隔符，并按字符数限长，避免中文被字节截断。
pub fn normalize_search_query(value: &str) -> String {
    let normalized = value.nfkc().flat_map(char::to_lowercase);
    let mut result = String::with_capacity(value.len());
    let mut pending_space = false;
    for character in normalized {
        let separator = character.is_whitespace()
            || matches!(
                character,
                '`' | '*' | '_' | '>' | '#' | '[' | ']' | '(' | ')' | '{' | '}' | '!' | '|' | '~'
            );
        if separator {
            pending_space = !result.is_empty();
        } else {
            if pending_space && result.chars().count() < SEARCH_QUERY_MAX_LENGTH {
                result.push(' ');
            }
            pending_space = false;
            if result.chars().count() >= SEARCH_QUERY_MAX_LENGTH {
                break;
            }
            result.push(character);
        }
    }
    result.trim_end().to_owned()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSearchRequest {
    pub rows: Vec<Value>,
    pub query: String,
    #[serde(default = "all_scope")]
    pub scope: String,
    #[serde(default = "first_page")]
    pub page: i64,
    #[serde(default = "default_page_size")]
    pub size: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSearchPage {
    pub items: Vec<Value>,
    pub total: usize,
    pub page: usize,
    pub size: usize,
    pub has_more: bool,
    pub engine: &'static str,
}

fn all_scope() -> String {
    "all".into()
}
fn first_page() -> i64 {
    1
}
fn default_page_size() -> i64 {
    30
}

pub fn search_mobile_rows(request: MobileSearchRequest) -> MobileSearchPage {
    let query = normalize_search_query(&request.query);
    let page = request.page.max(1) as usize;
    let size = request.size.clamp(1, SEARCH_PAGE_MAX_SIZE as i64) as usize;
    if query.is_empty() {
        return MobileSearchPage {
            items: vec![],
            total: 0,
            page,
            size,
            has_more: false,
            engine: "rust",
        };
    }
    let matches: Vec<Value> = request
        .rows
        .into_iter()
        .filter(|row| {
            let in_scope = request.scope == "all"
                || row.get("type").and_then(Value::as_str) == Some(request.scope.as_str());
            let contains = row
                .get("haystack")
                .and_then(Value::as_str)
                .is_some_and(|text| text.contains(&query));
            in_scope && contains
        })
        .collect();
    let total = matches.len();
    let offset = page.saturating_sub(1).saturating_mul(size);
    let items = matches
        .into_iter()
        .skip(offset)
        .take(size)
        .collect::<Vec<_>>();
    let has_more = offset.saturating_add(items.len()) < total;
    MobileSearchPage {
        items,
        total,
        page,
        size,
        has_more,
        engine: "rust",
    }
}

pub fn search_mobile_rows_json(input: &str) -> Result<String, String> {
    let request = serde_json::from_str(input).map_err(|error| error.to_string())?;
    serde_json::to_string(&search_mobile_rows(request)).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileCorpusRequest {
    #[serde(default)]
    pub knowledge: Vec<Value>,
    #[serde(default)]
    pub notes: Vec<Value>,
    #[serde(default)]
    pub tasks: Vec<Value>,
    #[serde(default)]
    pub recordings: Vec<Value>,
    #[serde(default)]
    pub areas: Vec<Value>,
    #[serde(default)]
    pub projects: Vec<Value>,
    pub query: String,
    #[serde(default = "all_scope")]
    pub scope: String,
    #[serde(default = "first_page")]
    pub page: i64,
    #[serde(default = "default_page_size")]
    pub size: i64,
}

fn string(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or("").to_owned()
}
fn field(value: &Value, name: &str) -> String {
    string(value.get(name))
}

pub fn search_mobile_corpus(request: MobileCorpusRequest) -> MobileSearchPage {
    use std::collections::HashMap;
    let areas: HashMap<String, String> = request
        .areas
        .iter()
        .map(|item| (field(item, "uid"), field(item, "name")))
        .collect();
    let project_names: HashMap<String, String> = request
        .projects
        .iter()
        .map(|item| (field(item, "uid"), field(item, "name")))
        .collect();
    let project_areas: HashMap<String, String> = request
        .projects
        .iter()
        .map(|item| (field(item, "uid"), field(item, "areaUid")))
        .collect();
    let mut rows = Vec::with_capacity(
        request.knowledge.len()
            + request.notes.len()
            + request.tasks.len()
            + request.recordings.len(),
    );
    let mut add = |kind: &str,
                   item: Value,
                   title_key: &str,
                   summary_keys: &[&str],
                   extra_keys: &[&str]| {
        let title = field(&item, title_key);
        let summary = summary_keys
            .iter()
            .map(|key| field(&item, key))
            .find(|value| !value.is_empty())
            .unwrap_or_default();
        let project_uid = field(&item, "projectUid");
        let direct_area = field(&item, "areaUid");
        let area_uid = if direct_area.is_empty() {
            project_areas.get(&project_uid).cloned().unwrap_or_default()
        } else {
            direct_area
        };
        let mut haystack = vec![title.clone(), summary.clone(), field(&item, "tags")];
        haystack.extend(extra_keys.iter().map(|key| field(&item, key)));
        rows.push(serde_json::json!({
            "type": kind, "uid": if field(&item, "uid").is_empty() { item.get("id").map(ToString::to_string).unwrap_or_default() } else { field(&item, "uid") },
            "title": title, "summary": summary,
            "areaName": areas.get(&area_uid).cloned().unwrap_or_default(),
            "projectName": project_names.get(&project_uid).cloned().unwrap_or_default(),
            "haystack": haystack.into_iter().map(|value| normalize_search_query(&value)).collect::<Vec<_>>().join(" ")
        }));
    };
    for item in request.knowledge {
        add(
            "knowledge",
            item,
            "title",
            &["conclusion", "content"],
            &["keyPoints", "applicability"],
        );
    }
    for item in request.notes {
        let kind = if item.get("periodType").is_some_and(|v| !v.is_null()) {
            "review"
        } else {
            "note"
        };
        add(kind, item, "title", &["content"], &[]);
    }
    for item in request.tasks {
        add("task", item, "title", &["description"], &["listName"]);
    }
    for item in request.recordings {
        add("recording", item, "name", &["createdAt"], &[]);
    }
    search_mobile_rows(MobileSearchRequest {
        rows,
        query: request.query,
        scope: request.scope,
        page: request.page,
        size: request.size,
    })
}

pub fn search_mobile_corpus_json(input: &str) -> Result<String, String> {
    let request = serde_json::from_str(input).map_err(|error| error.to_string())?;
    serde_json::to_string(&search_mobile_corpus(request)).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_matches_web_contract() {
        assert_eq!(normalize_search_query("  ＲＵＳＴ **性能**  "), "rust 性能");
    }

    #[test]
    fn mobile_search_filters_and_pages_without_changing_rows() {
        let rows = serde_json::from_value(serde_json::json!([
            {"uid":"1","type":"note","haystack":"rust 性能"},
            {"uid":"2","type":"task","haystack":"rust 测试"},
            {"uid":"3","type":"note","haystack":"rust 原生"}
        ]))
        .unwrap();
        let page = search_mobile_rows(MobileSearchRequest {
            rows,
            query: "ＲＵＳＴ".into(),
            scope: "note".into(),
            page: 2,
            size: 1,
        });
        assert_eq!(page.total, 2);
        assert_eq!(page.items[0]["uid"], "3");
        assert!(!page.has_more);
    }

    #[test]
    fn corpus_building_matches_mobile_context_and_review_rules() {
        let request: MobileCorpusRequest = serde_json::from_value(serde_json::json!({
            "notes":[{"uid":"n1","title":"发布记录","content":"Rust 性能","projectUid":"p1"},{"uid":"r1","title":"周回顾","periodType":"weekly","areaUid":"a1"}],
            "areas":[{"uid":"a1","name":"工作"}], "projects":[{"uid":"p1","name":"迹语","areaUid":"a1"}],
            "query":"ＲＵＳＴ", "scope":"note", "page":1, "size":30
        })).unwrap();
        let page = search_mobile_corpus(request);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0]["projectName"], "迹语");
        assert_eq!(page.items[0]["areaName"], "工作");
    }
}

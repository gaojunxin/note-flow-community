use base64::Engine;
use flate2::read::DeflateDecoder;
use quick_xml::{events::Event, Reader};
use serde_json::Value;
use std::io::Read;

pub const MAX_DOCUMENT_BYTES: usize = 50 * 1024 * 1024;

pub fn empty_document(canvas_type: &str, format: &str, version: &i64) -> Result<String, String> {
    match (canvas_type, format, version) {
        ("excalidraw", "excalidraw-json", 1) => Ok(r##"{"type":"excalidraw","version":2,"source":"note-flow","elements":[],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}"##.into()),
        ("mindmap", "noteflow-mindmap-v1", 1) => Ok(r#"{"schema":"note-flow.mindmap","version":1,"rootId":"mm-root","nodes":[{"id":"mm-root","parentId":null,"kind":"root","text":"中心主题","order":0}]}"#.into()),
        ("mindmap", "noteflow-mindmap-view-v1", 1) => Ok(r#"{"nodes":{},"collapsed":[],"viewport":{}}"#.into()),
        ("flowchart", "mermaid-text", 1) => Ok("flowchart TD\n".into()),
        ("knowledge_graph", "noteflow-knowledge-graph-view-v1", 1) => Ok(r#"{"query":{},"filters":{},"layout":{},"viewport":{}}"#.into()),
        ("diagrams", "drawio-xml", 1) => Ok(r#"<mxfile host="NoteFlow"><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>"#.into()),
        _ => Err(format!("unsupported: canvas format {canvas_type}/{format}/{version}")),
    }
}

pub fn text_index(
    canvas_type: &str,
    format: &str,
    version: &i64,
    document: &str,
) -> Result<String, String> {
    if document.len() > MAX_DOCUMENT_BYTES {
        return Err("invalid: canvas document exceeds 50 MiB".into());
    }
    let text = match (canvas_type, format, version) {
        ("excalidraw", "excalidraw-json", 1) => excalidraw(document)?,
        ("mindmap", "noteflow-mindmap-v1", 1) => mindmap_tree(document)?,
        ("mindmap", "noteflow-mindmap-view-v1", 1) => {
            json_object(document, "mindmap view")?;
            String::new()
        }
        ("flowchart", "mermaid-text", 1) => mermaid(document)?,
        ("knowledge_graph", "noteflow-knowledge-graph-view-v1", 1) => {
            json_object(document, "knowledge graph view")?;
            String::new()
        }
        ("diagrams", "drawio-xml", 1) => drawio(document)?,
        _ => {
            return Err(format!(
                "unsupported: canvas format {canvas_type}/{format}/{version}"
            ))
        }
    };
    Ok(text.chars().take(10_000).collect())
}

fn parse_json(document: &str, label: &str) -> Result<Value, String> {
    serde_json::from_str(document).map_err(|_| format!("invalid: malformed {label}"))
}

fn json_object(document: &str, label: &str) -> Result<Value, String> {
    let root = parse_json(document, label)?;
    if !root.is_object() {
        return Err(format!("invalid: {label} must be an object"));
    }
    Ok(root)
}

fn excalidraw(document: &str) -> Result<String, String> {
    let root = json_object(document, "Excalidraw scene")?;
    if root.get("type").and_then(Value::as_str) != Some("excalidraw")
        || !root.get("elements").is_some_and(Value::is_array)
    {
        return Err("invalid: document is not an Excalidraw scene".into());
    }
    Ok(root["elements"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| {
            item.get("type").and_then(Value::as_str) == Some("text")
                && item.get("isDeleted").and_then(Value::as_bool) != Some(true)
        })
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" "))
}

fn mindmap_tree(document: &str) -> Result<String, String> {
    let root = json_object(document, "mindmap tree")?;
    if root.get("schema").and_then(Value::as_str) != Some("note-flow.mindmap")
        || root.get("version").and_then(Value::as_i64) != Some(1)
    {
        return Err("invalid: unsupported mindmap schema".into());
    }
    let root_id = root
        .get("rootId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "invalid: mindmap rootId is required".to_string())?;
    let nodes = root
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "invalid: mindmap nodes must be an array".to_string())?;
    if nodes.is_empty() || nodes.len() > 10_000 {
        return Err("invalid: mindmap node count is out of range".into());
    }
    let ids = nodes
        .iter()
        .filter_map(|node| node.get("id").and_then(Value::as_str))
        .collect::<std::collections::HashSet<_>>();
    if ids.len() != nodes.len() || !ids.contains(root_id) {
        return Err("invalid: mindmap contains duplicate ids or a missing root".into());
    }
    for node in nodes {
        let id = node.get("id").and_then(Value::as_str).unwrap_or("");
        if id != root_id
            && !node
                .get("parentId")
                .and_then(Value::as_str)
                .is_some_and(|parent| ids.contains(parent))
        {
            return Err("invalid: mindmap contains an orphan node".into());
        }
    }
    Ok(nodes
        .iter()
        .filter_map(|node| node.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" "))
}

fn mermaid(document: &str) -> Result<String, String> {
    if document.trim().is_empty() {
        return Err("invalid: Mermaid document is empty".into());
    }
    if document.contains('\0') {
        return Err("invalid: Mermaid document contains NUL".into());
    }
    Ok(document.split_whitespace().collect::<Vec<_>>().join(" "))
}

const MAX_DRAWIO_DEPTH: usize = 128;
const MAX_DRAWIO_NODES: usize = 200_000;
const MAX_DRAWIO_EXPANDED_BYTES: usize = 50 * 1024 * 1024;
const MAX_DRAWIO_EXPANSION_RATIO: usize = 200;

fn drawio(document: &str) -> Result<String, String> {
    if document.as_bytes().len() > MAX_DOCUMENT_BYTES {
        return Err("invalid: draw.io document exceeds 50 MiB".into());
    }
    let (text, pages) = parse_drawio_xml(document, true)?;
    if pages == 0 {
        return Err("invalid: draw.io mxfile has no diagram pages".into());
    }
    Ok(text)
}

fn parse_drawio_xml(document: &str, outer: bool) -> Result<(String, usize), String> {
    let upper = document.to_ascii_uppercase();
    if upper.contains("<!DOCTYPE") || upper.contains("<!ENTITY") {
        return Err("invalid: draw.io DTD and entities are forbidden".into());
    }
    let mut reader = Reader::from_str(document);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut depth = 0usize;
    let mut nodes = 0usize;
    let mut pages = 0usize;
    let mut root_seen = false;
    let mut in_diagram = false;
    let mut diagram_has_elements = false;
    let mut diagram_text = String::new();
    let mut terms = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                depth += 1;
                nodes += 1;
                if depth > MAX_DRAWIO_DEPTH || nodes > MAX_DRAWIO_NODES {
                    return Err("invalid: draw.io XML complexity limit exceeded".into());
                }
                let name = event.local_name();
                if depth == 1 {
                    root_seen = if outer {
                        name.as_ref() == b"mxfile"
                    } else {
                        name.as_ref() == b"mxGraphModel"
                    };
                }
                if outer && name.as_ref() == b"diagram" {
                    pages += 1;
                    in_diagram = true;
                    diagram_has_elements = false;
                    diagram_text.clear();
                }
                if in_diagram && name.as_ref() != b"diagram" {
                    diagram_has_elements = true;
                }
                collect_attributes(&event, reader.decoder(), &mut terms)?;
            }
            Ok(Event::Empty(event)) => {
                nodes += 1;
                if nodes > MAX_DRAWIO_NODES {
                    return Err("invalid: draw.io XML node limit exceeded".into());
                }
                collect_attributes(&event, reader.decoder(), &mut terms)?;
                if in_diagram {
                    diagram_has_elements = true;
                }
            }
            Ok(Event::Text(event)) => {
                let decoded = event
                    .decode()
                    .map_err(|_| "invalid: malformed draw.io text".to_string())?;
                let value = quick_xml::escape::unescape(&decoded)
                    .map_err(|_| "invalid: malformed draw.io text".to_string())?;
                if in_diagram && !diagram_has_elements {
                    diagram_text.push_str(&value);
                } else if !value.trim().is_empty() {
                    terms.push(value.into_owned());
                }
            }
            Ok(Event::End(event)) => {
                if outer && event.local_name().as_ref() == b"diagram" {
                    if !diagram_has_elements && !diagram_text.trim().is_empty() {
                        let expanded = decode_drawio_payload(diagram_text.trim())?;
                        let (inner_terms, _) = parse_drawio_xml(&expanded, false)?;
                        terms.push(inner_terms);
                    }
                    in_diagram = false;
                }
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| "invalid: malformed draw.io XML nesting".to_string())?;
            }
            Ok(Event::DocType(_)) => {
                return Err("invalid: draw.io DTD and entities are forbidden".into())
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err("invalid: malformed draw.io XML".into()),
            _ => {}
        }
        buf.clear();
    }
    if !root_seen || depth != 0 {
        return Err("invalid: unexpected draw.io XML root".into());
    }
    Ok((
        terms
            .into_iter()
            .filter(|s| !s.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" "),
        pages,
    ))
}

fn collect_attributes(
    event: &quick_xml::events::BytesStart<'_>,
    decoder: quick_xml::encoding::Decoder,
    terms: &mut Vec<String>,
) -> Result<(), String> {
    for attr in event.attributes() {
        let attr = attr.map_err(|_| "invalid: malformed draw.io attribute".to_string())?;
        let key = attr.key.as_ref();
        let value = attr
            .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, decoder)
            .map_err(|_| "invalid: malformed draw.io attribute value".to_string())?
            .into_owned();
        let lower = value.trim().to_ascii_lowercase();
        if matches!(key, b"href" | b"src" | b"xlink:href")
            && (lower.starts_with("http://")
                || lower.starts_with("https://")
                || lower.starts_with("file:")
                || lower.starts_with("ftp:"))
        {
            return Err("invalid: external draw.io resources are forbidden".into());
        }
        if matches!(key, b"value" | b"label" | b"name") && !value.trim().is_empty() {
            terms.push(value);
        }
    }
    Ok(())
}

fn decode_drawio_payload(encoded: &str) -> Result<String, String> {
    let compressed = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "invalid: malformed draw.io compressed payload".to_string())?;
    let mut decoder = DeflateDecoder::new(compressed.as_slice());
    let mut expanded = Vec::new();
    decoder
        .by_ref()
        .take((MAX_DRAWIO_EXPANDED_BYTES + 1) as u64)
        .read_to_end(&mut expanded)
        .map_err(|_| "invalid: malformed draw.io compressed payload".to_string())?;
    if expanded.len() > MAX_DRAWIO_EXPANDED_BYTES
        || expanded.len() > compressed.len().max(1) * MAX_DRAWIO_EXPANSION_RATIO
    {
        return Err("invalid: draw.io compressed payload expansion limit exceeded".into());
    }
    let escaped = String::from_utf8(expanded)
        .map_err(|_| "invalid: draw.io payload is not UTF-8".to_string())?;
    percent_decode(&escaped)
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("invalid: malformed draw.io percent encoding".into());
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                .map_err(|_| "invalid: malformed draw.io percent encoding".to_string())?;
            out.push(
                u8::from_str_radix(hex, 16)
                    .map_err(|_| "invalid: malformed draw.io percent encoding".to_string())?,
            );
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "invalid: draw.io payload is not UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenFixture {
        schema_version: u32,
        cases: Vec<GoldenCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenCase {
        id: String,
        canvas_type: String,
        data_format: String,
        data_version: i64,
        document_data: String,
        expect: GoldenExpectation,
    }

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "lowercase")]
    enum GoldenExpectation {
        Ok {
            #[serde(rename = "textIndex")]
            text_index: String,
        },
        Error {
            #[serde(rename = "errorPrefix")]
            error_prefix: String,
        },
    }

    #[test]
    fn matches_shared_canvas_golden_fixtures() {
        let fixture: GoldenFixture = serde_json::from_str(include_str!(
            "../../../contracts/canvas/fixtures/golden.json"
        ))
        .unwrap();
        assert_eq!(fixture.schema_version, 1);
        assert!(fixture.cases.len() >= 24);
        for case in fixture.cases {
            let result = text_index(
                &case.canvas_type,
                &case.data_format,
                &case.data_version,
                &case.document_data,
            );
            match case.expect {
                GoldenExpectation::Ok { text_index } => assert_eq!(
                    result.unwrap_or_else(|error| panic!("{}: {error}", case.id)),
                    text_index,
                    "{}",
                    case.id
                ),
                GoldenExpectation::Error { error_prefix } => assert!(
                    result
                        .expect_err(&format!("{} should fail", case.id))
                        .starts_with(&error_prefix),
                    "{}",
                    case.id
                ),
            }
        }
    }
    #[test]
    fn indexes_mindmap() {
        assert_eq!(text_index("mindmap", "noteflow-mindmap-v1", &1, r#"{"schema":"note-flow.mindmap","version":1,"rootId":"r","nodes":[{"id":"r","parentId":null,"text":"Root"},{"id":"c","parentId":"r","text":"Child"}]}"#).unwrap(), "Root Child");
    }
    #[test]
    fn indexes_mermaid() {
        assert_eq!(
            text_index("flowchart", "mermaid-text", &1, "flowchart TD\n A-->B").unwrap(),
            "flowchart TD A-->B"
        );
    }
    #[test]
    fn validates_view_documents() {
        assert!(text_index(
            "knowledge_graph",
            "noteflow-knowledge-graph-view-v1",
            &1,
            "[]"
        )
        .unwrap_err()
        .starts_with("invalid:"));
    }
    #[test]
    fn indexes_drawio_multiple_pages() {
        let xml = r#"<mxfile><diagram name="First"><mxGraphModel><root><mxCell id="2" value="Alpha"/></root></mxGraphModel></diagram><diagram name="Second"><mxGraphModel><root><mxCell id="3" value="Beta"/></root></mxGraphModel></diagram></mxfile>"#;
        let index = text_index("diagrams", "drawio-xml", &1, xml).unwrap();
        assert!(
            index.contains("First")
                && index.contains("Alpha")
                && index.contains("Second")
                && index.contains("Beta")
        );
    }
    #[test]
    fn rejects_drawio_entities_and_external_resources() {
        assert!(text_index("diagrams", "drawio-xml", &1, r#"<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><mxfile><diagram>&e;</diagram></mxfile>"#).is_err());
        assert!(text_index("diagrams", "drawio-xml", &1, r#"<mxfile><diagram><mxGraphModel><root><mxCell src="https://example.com/a.png"/></root></mxGraphModel></diagram></mxfile>"#).is_err());
    }
    #[test]
    fn indexes_compressed_drawio_payload() {
        use flate2::{write::DeflateEncoder, Compression};
        use std::io::Write;
        let inner = "%3CmxGraphModel%3E%3Croot%3E%3CmxCell%20value%3D%22Compressed%22%2F%3E%3C%2Froot%3E%3C%2FmxGraphModel%3E";
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(inner.as_bytes()).unwrap();
        let payload = base64::engine::general_purpose::STANDARD.encode(encoder.finish().unwrap());
        let xml = format!(r#"<mxfile><diagram name="Packed">{payload}</diagram></mxfile>"#);
        assert!(text_index("diagrams", "drawio-xml", &1, &xml)
            .unwrap()
            .contains("Compressed"));
    }
    #[test]
    fn rejects_drawio_complexity_and_expansion_limits() {
        let deep = format!(
            "<mxfile><diagram>{}</diagram></mxfile>",
            "<a>".repeat(MAX_DRAWIO_DEPTH + 1) + &"</a>".repeat(MAX_DRAWIO_DEPTH + 1)
        );
        assert!(text_index("diagrams", "drawio-xml", &1, &deep).is_err());
        use flate2::{write::DeflateEncoder, Compression};
        use std::io::Write;
        let bomb = "A".repeat(100_000);
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(bomb.as_bytes()).unwrap();
        let payload = base64::engine::general_purpose::STANDARD.encode(encoder.finish().unwrap());
        assert!(text_index(
            "diagrams",
            "drawio-xml",
            &1,
            &format!("<mxfile><diagram>{payload}</diagram></mxfile>")
        )
        .is_err());
    }
}

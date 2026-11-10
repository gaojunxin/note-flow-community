//! 任务提醒URI及XML的纯数据边界，不接受任意路由或脚本参数。
use base64::Engine;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub owner_id: String,
    pub task_uid: String,
}
pub(crate) fn scheme(identifier: &str) -> &'static str {
    if identifier.contains(".community.") {
        "noteflow-community-task"
    } else {
        "noteflow-task"
    }
}
fn valid(target: &Target) -> bool {
    [&target.owner_id, &target.task_uid].iter().all(|value| {
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    })
}
pub(crate) fn uri(identifier: &str, target: &Target) -> Result<String, String> {
    if !valid(target) {
        return Err("任务提醒身份无效".into());
    }
    let payload = serde_json::to_vec(target).map_err(|_| "任务提醒编码失败")?;
    Ok(format!(
        "{}://task/{}",
        scheme(identifier),
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload)
    ))
}
pub(crate) fn parse(identifier: &str, value: &str) -> Option<Target> {
    let prefix = format!("{}://task/", scheme(identifier));
    let payload = value.strip_prefix(&prefix)?;
    if payload.len() > 1024 {
        return None;
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let target: Target = serde_json::from_slice(&bytes).ok()?;
    valid(&target).then_some(target)
}
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
pub(crate) fn xml(
    identifier: &str,
    target: &Target,
    title: &str,
    body: &str,
) -> Result<String, String> {
    Ok(format!("<toast activationType=\"protocol\" launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>", escape(&uri(identifier, target)?), escape(title), escape(body)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_keeps_owner_and_task_and_rejects_other_edition() {
        let target = Target {
            owner_id: "profile-1".into(),
            task_uid: "task-2".into(),
        };
        let value = uri("com.noteflow.desktop", &target).unwrap();
        assert_eq!(parse("com.noteflow.desktop", &value), Some(target));
        assert_eq!(parse("com.noteflow.community.desktop", &value), None);
        assert_eq!(parse("com.noteflow.desktop", "https://task/abc"), None);
    }
    #[test]
    fn arbitrary_protocol_payloads_and_xml_injection_are_rejected_or_escaped() {
        assert!(parse("com.noteflow.desktop", "noteflow-task://task/invalid!!!").is_none());
        let bad = Target {
            owner_id: "other/profile".into(),
            task_uid: "task".into(),
        };
        assert!(uri("com.noteflow.desktop", &bad).is_err());
        let target = Target {
            owner_id: "profile".into(),
            task_uid: "task".into(),
        };
        let value = xml("com.noteflow.desktop", &target, "<script>", "&\"'").unwrap();
        assert!(value.contains("activationType=\"protocol\""));
        assert!(!value.contains("<script>"));
        assert!(value.contains("&lt;script&gt;"));
    }
}

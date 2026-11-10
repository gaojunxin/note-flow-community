/// The reviewed offline editor needs its own CSP, rather than the app UI policy.
/// Only these two packaged HTML paths receive it; no remote origin is allowed.
pub fn offline_editor_csp(path: &str) -> Option<&'static str> {
    match path {
        "/vendor/diagrams/index.html" => Some("default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"),
        "/vendor/diagrams/noteflow-bridge.html" => Some("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"),
        _ => None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_reviewed_packaged_editor_pages_receive_the_offline_policy() {
        assert!(offline_editor_csp("/vendor/diagrams/index.html")
            .unwrap()
            .contains("'unsafe-eval'"));
        assert!(!offline_editor_csp("/vendor/diagrams/noteflow-bridge.html")
            .unwrap()
            .contains("'unsafe-eval'"));
        for path in [
            "/community.html",
            "/vendor/diagrams/other.html",
            "/vendor/diagrams/index.html/evil",
            "https://example.com/vendor/diagrams/index.html",
        ] {
            assert!(offline_editor_csp(path).is_none());
        }
    }
}

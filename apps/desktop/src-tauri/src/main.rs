#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    note_flow_community_desktop::community::run(tauri::generate_context!());
}

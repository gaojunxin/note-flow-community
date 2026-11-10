use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProbe {
    os: String,
    distribution: Option<String>,
    package_type: String,
    desktop_session: bool,
    opener_available: bool,
    default_application: Option<bool>,
}
fn executable(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|p| p.join(name))
        .find(|p| {
            if !p.is_file() {
                return false;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                return p
                    .metadata()
                    .is_ok_and(|m| m.permissions().mode() & 0o111 != 0);
            }
            #[cfg(not(unix))]
            {
                true
            }
        })
}
fn opener() -> &'static str {
    if cfg!(target_os = "windows") {
        "explorer.exe"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    }
}
#[tauri::command]
pub async fn attachment_system_probe(media_type: String) -> Result<SystemProbe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut default_application = None;
        if cfg!(target_os = "linux")
            && media_type.len() < 128
            && media_type
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "/-+._".contains(c))
        {
            if let Some(program) = executable("xdg-mime") {
                if let Ok(mut child) = Command::new(program)
                    .args(["query", "default", &media_type])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn()
                {
                    let start = Instant::now();
                    loop {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                if status.success() {
                                    if let Ok(output) = child.wait_with_output() {
                                        default_application = Some(!output.stdout.is_empty())
                                    }
                                }
                                break;
                            }
                            Ok(None) if start.elapsed() < Duration::from_secs(2) => {
                                std::thread::sleep(Duration::from_millis(25))
                            }
                            _ => {
                                let _ = child.kill();
                                let _ = child.wait();
                                break;
                            }
                        }
                    }
                }
            }
        }
        SystemProbe {
            os: std::env::consts::OS.into(),
            distribution: if cfg!(target_os = "linux") {
                std::fs::read_to_string("/etc/os-release")
                    .ok()
                    .and_then(|s| {
                        s.lines().find_map(|l| {
                            l.strip_prefix("PRETTY_NAME=")
                                .map(|v| v.trim_matches('"').chars().take(120).collect())
                        })
                    })
            } else {
                None
            },
            package_type: if std::env::var_os("APPIMAGE").is_some() {
                "AppImage"
            } else {
                "unknown"
            }
            .into(),
            desktop_session: !cfg!(target_os = "linux")
                || std::env::var_os("DISPLAY").is_some()
                || std::env::var_os("WAYLAND_DISPLAY").is_some(),
            opener_available: executable(opener()).is_some(),
            default_application,
        }
    })
    .await
    .map_err(|_| "SYSTEM_PROBE_FAILED".into())
}
/// Only checks the launcher result, never claims the application displayed the file.
pub fn open_target(target: &Path, reveal: bool) -> Result<String, String> {
    let mut command = Command::new(opener());
    if cfg!(target_os = "windows") && reveal {
        command.arg(format!("/select,{}", target.display()));
    } else if cfg!(target_os = "macos") && reveal {
        command.arg("-R").arg(target);
    } else {
        command.arg(if reveal {
            target.parent().ok_or("INVALID_MEDIA_PATH")?
        } else {
            target
        });
    }
    run_launcher(&mut command)
}
fn run_launcher(command: &mut Command) -> Result<String, String> {
    let mut child = command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "SYSTEM_OPENER_MISSING".to_string()
            } else {
                "SYSTEM_OPENER_START_FAILED".to_string()
            }
        })?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok("accepted".into())
                } else {
                    Err(format!("SYSTEM_OPEN_EXIT:{}", status.code().unwrap_or(-1)))
                }
            }
            Ok(None) if start.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(25))
            }
            Ok(None) => {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok("submitted".into());
            }
            Err(_) => return Err("SYSTEM_OPEN_STATUS_FAILED".into()),
        }
    }
}
pub fn media_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let parts: Vec<_> = relative.split('/').collect();
    if parts.len() != 2
        || !matches!(parts[0], "attachments" | "recordings")
        || parts[1].is_empty()
        || parts[1].contains("..")
        || parts[1].contains(['\\', '\0', ':'])
    {
        return Err("INVALID_MEDIA_PATH".into());
    }
    let scope = root.canonicalize().map_err(|_| "LOCAL_FILE_MISSING")?;
    let target = root.join(relative).canonicalize().map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "LOCAL_FILE_PERMISSION"
        } else {
            "LOCAL_FILE_MISSING"
        }
    })?;
    if !target.starts_with(scope) || !target.is_file() {
        return Err("INVALID_MEDIA_PATH".into());
    }
    Ok(target)
}
/// Check presence and size without reading file contents.
pub fn media_size(root: &Path, relative: &str) -> Result<Option<u64>, String> {
    match media_path(root, relative) {
        Ok(target) => std::fs::metadata(target).map(|value| Some(value.len())).map_err(|_| "LOCAL_FILE_PERMISSION".into()),
        Err(code) if code == "LOCAL_FILE_MISSING" => Ok(None),
        Err(code) => Err(code),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_traversal_and_outside_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("attachments")).unwrap();
        std::fs::write(temp.path().join("attachments/file.txt"), "ok").unwrap();
        assert!(media_path(temp.path(), "attachments/file.txt").is_ok());
        for value in [
            "attachments/../file",
            "attachments/",
            "attachments/../../file",
            "attachments/\\file",
            "attachments/C:file",
            "other/file",
        ] {
            assert!(media_path(temp.path(), value).is_err())
        }
    }
    #[test]
    fn checks_file_size_without_reading_contents_and_rejects_invalid_paths() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("attachments")).unwrap();
        std::fs::write(temp.path().join("attachments/synthetic.bin"), [1_u8, 2, 3]).unwrap();
        assert_eq!(media_size(temp.path(), "attachments/synthetic.bin").unwrap(), Some(3));
        assert_eq!(media_size(temp.path(), "attachments/missing").unwrap(), None);
        assert!(media_size(temp.path(), "attachments/../outside").is_err());
    }
    #[test]
    fn reports_missing_file() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(
            media_path(temp.path(), "attachments/missing").unwrap_err(),
            "LOCAL_FILE_MISSING"
        )
    }
    #[test]
    fn launcher_start_errors_are_reported_without_paths() {
        assert_eq!(
            run_launcher(&mut Command::new("noteflow-nonexistent-launcher-9bf046")).unwrap_err(),
            "SYSTEM_OPENER_MISSING"
        );
    }
    #[cfg(unix)]
    #[test]
    fn launcher_exit_failures_are_observed() {
        assert_eq!(
            run_launcher(&mut Command::new("/bin/false")).unwrap_err(),
            "SYSTEM_OPEN_EXIT:1"
        );
        assert_eq!(
            run_launcher(&mut Command::new("/bin/true")).unwrap(),
            "accepted"
        );
    }
    #[cfg(unix)]
    #[test]
    fn cannot_reveal_a_symlink_outside_the_profile() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("attachments")).unwrap();
        let target = outside.path().join("secret.txt");
        std::fs::write(&target, "secret").unwrap();
        std::os::unix::fs::symlink(target, root.path().join("attachments/link")).unwrap();
        assert_eq!(
            media_path(root.path(), "attachments/link").unwrap_err(),
            "INVALID_MEDIA_PATH"
        );
    }
}

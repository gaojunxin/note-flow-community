use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path, sync::Mutex};

// 检查目标到发布并关闭句柄必须串行；Windows下并发替换同一路径会发生共享/删除冲突。
// 锁只协调本进程的保存调用，不代表其他进程或外部程序也受此约束。
static MEDIA_WRITES: Mutex<()> = Mutex::new(());

/// 仅保存与内容地址摘要一致的字节；已有损坏副本通过同目录临时文件原子替换。
/// 拒绝目标符号链接，每次写入独占临时文件；返回相对文件名，调用方负责媒体根目录归属。
pub(crate) fn save_verified(root: &Path, file_name: &str, sha256: &str, bytes: &[u8]) -> Result<String, String> {
    let digest = sha256.to_ascii_lowercase();
    if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("无效媒体校验值".into());
    }
    if format!("{:x}", Sha256::digest(bytes)) != digest {
        return Err("媒体内容与 SHA256 不一致".into());
    }
    let extension = Path::new(file_name).extension().and_then(|value| value.to_str())
        .map(|value| value.chars().filter(|c| c.is_ascii_alphanumeric()).take(10).collect::<String>())
        .filter(|value| !value.is_empty());
    let name = extension.map(|value| format!("{digest}.{value}")).unwrap_or(digest);
    let _write = MEDIA_WRITES.lock().map_err(|_| "媒体写入协调状态异常，请重新启动客户端".to_string())?;
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let target = root.join(&name);
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.file_type().is_symlink() { return Err("媒体路径不是普通文件".into()); }
            let existing = fs::read(&target).map_err(|error| error.to_string())?;
            if Sha256::digest(&existing) == Sha256::digest(bytes) { return Ok(name); }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    // 先验证输入摘要，再把完整字节写入同目录临时文件；不可把未校验的部分内容发布到摘要路径。
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(|error| error.to_string())?;
    temporary.write_all(bytes).map_err(|error| error.to_string())?;
    temporary.as_file().sync_all().map_err(|error| error.to_string())?;
    // 返回的File也须在释放写锁前关闭，下一调用才能安全校验或替换当前路径。
    drop(temporary.persist(&target).map_err(|error| error.error.to_string())?);
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
    #[test] fn verifies_before_creating_any_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save_verified(dir.path(), "test.bin", &hash(b"original"), b"changed").is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(save_verified(dir.path(), "test.bin", "../escape", b"original").is_err());
    }
    #[test] fn reuses_intact_content_and_repairs_corrupt_existing_bytes() {
        let dir = tempfile::tempdir().unwrap(); let digest = hash(b"synthetic");
        let name = save_verified(dir.path(), "test.bin", &digest, b"synthetic").unwrap();
        assert_eq!(save_verified(dir.path(), "test.bin", &digest, b"synthetic").unwrap(), name);
        fs::write(dir.path().join(&name), b"corrupt").unwrap();
        save_verified(dir.path(), "test.bin", &digest, b"synthetic").unwrap();
        assert_eq!(fs::read(dir.path().join(name)).unwrap(), b"synthetic");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test] fn concurrent_saves_do_not_share_temporary_paths() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().to_path_buf();
        let digest = hash(b"synthetic");
        // 同时起跑分别覆盖首次发布和损坏副本修复，保留原Windows失败场景。
        for repair in [false, true] {
            if repair { fs::write(path.join(format!("{digest}.bin")), b"corrupt").unwrap(); }
            let start = std::sync::Arc::new(std::sync::Barrier::new(8));
            let threads: Vec<_> = (0..8).map(|_| {
                let path = path.clone(); let start = start.clone();
                std::thread::spawn(move || {
                    start.wait();
                    save_verified(&path, "test.bin", &hash(b"synthetic"), b"synthetic").unwrap()
                })
            }).collect();
            for thread in threads { let name = thread.join().unwrap(); assert_eq!(fs::read(path.join(name)).unwrap(), b"synthetic"); }
            assert_eq!(fs::read_dir(&path).unwrap().count(), 1);
        }
    }
    #[cfg(unix)]
    #[test] fn refuses_a_symlink_without_modifying_its_target() {
        let dir = tempfile::tempdir().unwrap(); let outside = tempfile::NamedTempFile::new().unwrap();
        fs::write(outside.path(), b"outside").unwrap();
        let digest = hash(b"synthetic"); std::os::unix::fs::symlink(outside.path(), dir.path().join(format!("{digest}.bin"))).unwrap();
        assert!(save_verified(dir.path(), "test.bin", &digest, b"synthetic").is_err());
        assert_eq!(fs::read(outside.path()).unwrap(), b"outside");
    }
}

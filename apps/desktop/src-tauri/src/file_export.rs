use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    io::{self, Write},
    path::Path,
};
const MAX_SIZE: usize = 64 * 1024 * 1024;
pub fn prepare(name: &str, encoded: &str) -> Result<(String, Vec<u8>), ()> {
    prepare_bounded(name, encoded, MAX_SIZE)
}
/// 在Base64解码前后分别限量；输出名只是保存对话框建议名，不能当作可信目标路径。
pub fn prepare_bounded(
    name: &str,
    encoded: &str,
    max_size: usize,
) -> Result<(String, Vec<u8>), ()> {
    if max_size > 256 * 1024 * 1024 || encoded.len() > max_size.div_ceil(3) * 4 {
        return Err(());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| ())?;
    if bytes.len() > max_size {
        return Err(());
    }
    let name: String = name
        .chars()
        .filter(|ch| !ch.is_control())
        .map(|ch| if ch == '/' || ch == '\\' { '_' } else { ch })
        .take(160)
        .collect();
    let name = if name.trim().is_empty() || name == "." || name == ".." {
        "NoteFlow-export".to_string()
    } else {
        name
    };
    Ok((name, bytes))
}
/// The destination comes exclusively from the native save dialog, never from IPC arguments.
/// 使用目标同目录临时文件并刷新后替换；写入失败不先截断用户选择的原文件。
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("No document directory"))?;
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    output.write_all(bytes)?;
    output.as_file_mut().sync_all()?;
    output.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    std::fs::File::open(parent)?.sync_all()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_binary_payload_and_suggested_name() {
        let (name, bytes) = prepare("../notes\\file.md\n", "AID/").unwrap();
        assert_eq!(name, ".._notes_file.md");
        assert_eq!(bytes, vec![0, 128, 255]);
        assert!(prepare("bad", "not base64").is_err());
        assert_eq!(prepare("..", "").unwrap().0, "NoteFlow-export");
    }
    #[test]
    fn replaces_selected_document_and_does_not_change_it_on_invalid_destination() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("backup.json");
        std::fs::write(&path, b"old").unwrap();
        write_atomic(&path, b"new bytes").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new bytes");
        assert!(write_atomic(&directory.path().join("missing/backup.json"), b"bad").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"new bytes");
    }
}

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
#[derive(Clone)]
pub struct ExportPermit {
    path: PathBuf,
    cancelled: Arc<AtomicBool>,
    publication: Arc<Mutex<()>>,
    expires: Instant,
    pub max_size: usize,
}
impl ExportPermit {
    fn cancel(&self) {
        // Serialize cancellation with the final check and atomic publication.
        // A poisoned publication lock makes subsequent writes fail closed.
        let _publication = self.publication.lock();
        self.cancelled.store(true, Ordering::SeqCst);
    }
    pub fn write(&self, bytes: &[u8]) -> io::Result<()> {
        if bytes.len() > self.max_size {
            return Err(io::Error::other("Export exceeds authorized size"));
        }
        write_atomic_guarded(
            &self.path,
            bytes,
            || !self.cancelled.load(Ordering::SeqCst) && Instant::now() < self.expires,
            Some(&self.publication),
        )
    }
}
struct Lease {
    owner: String,
    permit: ExportPermit,
    claimed: bool,
}
#[derive(Default)]
pub struct ExportLeases {
    entries: Mutex<HashMap<String, Lease>>,
}
impl ExportLeases {
    pub fn insert(&self, owner: &str, path: PathBuf) -> Result<String, ()> {
        self.insert_bounded(owner, path, MAX_SIZE)
    }
    pub fn insert_bounded(
        &self,
        owner: &str,
        path: PathBuf,
        max_size: usize,
    ) -> Result<String, ()> {
        if max_size != MAX_SIZE && max_size != 100 * 1024 * 1024 && max_size != 256 * 1024 * 1024 {
            return Err(());
        }
        let mut entries = self.entries.lock().map_err(|_| ())?;
        entries.retain(|_, entry| {
            let live = Instant::now() < entry.permit.expires;
            if !live {
                entry.permit.cancel()
            }
            live
        });
        if entries.len() >= 32 {
            return Err(());
        }
        let uid = uuid::Uuid::new_v4().to_string();
        entries.insert(
            uid.clone(),
            Lease {
                owner: owner.to_string(),
                claimed: false,
                permit: ExportPermit {
                    path,
                    max_size,
                    cancelled: Arc::new(AtomicBool::new(false)),
                    publication: Arc::new(Mutex::new(())),
                    expires: Instant::now() + Duration::from_secs(120),
                },
            },
        );
        Ok(uid)
    }
    pub fn claim(&self, owner: &str, uid: &str) -> Result<ExportPermit, ()> {
        let mut entries = self.entries.lock().map_err(|_| ())?;
        let entry = entries.get_mut(uid).ok_or(())?;
        if entry.owner != owner || entry.claimed || Instant::now() >= entry.permit.expires {
            return Err(());
        }
        entry.claimed = true;
        Ok(entry.permit.clone())
    }
    pub fn cancel_owner(&self, owner: &str) -> Result<(), ()> {
        let mut entries = self.entries.lock().map_err(|_| ())?;
        entries.retain(|_, entry| {
            if entry.owner == owner {
                entry.permit.cancel();
                false
            } else {
                true
            }
        });
        Ok(())
    }
    pub fn cancel(&self, owner: &str, uid: &str) -> Result<(), ()> {
        let mut entries = self.entries.lock().map_err(|_| ())?;
        if let Some(entry) = entries.get(uid) {
            if entry.owner != owner {
                return Err(());
            }
            entry.permit.cancel();
        }
        entries.remove(uid);
        Ok(())
    }
}
pub fn write_atomic_checked(
    path: &Path,
    bytes: &[u8],
    current: impl Fn() -> bool,
) -> io::Result<()> {
    write_atomic_guarded(path, bytes, current, None)
}
fn write_atomic_guarded(
    path: &Path,
    bytes: &[u8],
    current: impl Fn() -> bool,
    publication: Option<&Mutex<()>>,
) -> io::Result<()> {
    if !current() {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "Export cancelled",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("No document directory"))?;
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    output.write_all(bytes)?;
    output.as_file_mut().sync_all()?;
    let _publication = publication
        .map(|gate| {
            gate.lock()
                .map_err(|_| io::Error::other("Export publication unavailable"))
        })
        .transpose()?;
    if !current() {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "Export cancelled",
        ));
    }
    output.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    std::fs::File::open(parent)?.sync_all()?;
    Ok(())
}
#[cfg(test)]
mod lease_tests {
    use super::*;
    #[test]
    fn leases_bind_windows_and_cannot_be_replayed() {
        let dir = tempfile::tempdir().unwrap();
        let leases = ExportLeases::default();
        let uid = leases
            .insert("a", dir.path().join("synthetic.txt"))
            .unwrap();
        assert!(leases.claim("b", &uid).is_err());
        assert!(leases.cancel("b", &uid).is_err());
        let permit = leases.claim("a", &uid).unwrap();
        assert!(leases.claim("a", &uid).is_err());
        permit.write(b"synthetic").unwrap();
        leases.cancel("a", &uid).unwrap();
        assert!(leases.claim("a", &uid).is_err());
    }
    #[test]
    fn expired_permit_cannot_write_and_expired_slots_are_reclaimed() {
        let dir = tempfile::tempdir().unwrap();
        let leases = ExportLeases::default();
        let uid = leases.insert("a", dir.path().join("expired.txt")).unwrap();
        {
            let mut entries = leases.entries.lock().unwrap();
            entries.get_mut(&uid).unwrap().permit.expires = Instant::now() - Duration::from_secs(1);
        }
        assert!(leases.claim("a", &uid).is_err());
        let next = leases.insert("a", dir.path().join("next.txt")).unwrap();
        assert!(!leases.entries.lock().unwrap().contains_key(&uid));
        let mut permit = leases.claim("a", &next).unwrap();
        permit.expires = Instant::now() - Duration::from_secs(1);
        assert!(permit.write(b"synthetic").is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn outstanding_destinations_are_bounded_and_cancellation_frees_capacity() {
        let dir = tempfile::tempdir().unwrap();
        let leases = ExportLeases::default();
        let mut ids = Vec::new();
        for n in 0..32 {
            ids.push(
                leases
                    .insert("a", dir.path().join(format!("synthetic-{n}.txt")))
                    .unwrap(),
            );
        }
        assert!(leases.insert("a", dir.path().join("overflow.txt")).is_err());
        leases.cancel("a", &ids[0]).unwrap();
        assert!(leases.insert("a", dir.path().join("next.txt")).is_ok());
    }
    #[test]
    fn destroyed_owner_revokes_claimed_and_pending_leases_without_affecting_other_windows() {
        let dir = tempfile::tempdir().unwrap();
        let leases = ExportLeases::default();
        let claimed = leases
            .insert("closing", dir.path().join("claimed.txt"))
            .unwrap();
        let permit = leases.claim("closing", &claimed).unwrap();
        let pending = leases
            .insert("closing", dir.path().join("pending.txt"))
            .unwrap();
        let other = leases
            .insert("other", dir.path().join("other.txt"))
            .unwrap();
        leases.cancel_owner("closing").unwrap();
        assert!(permit.write(b"synthetic").is_err());
        assert!(leases.claim("closing", &pending).is_err());
        leases
            .claim("other", &other)
            .unwrap()
            .write(b"synthetic")
            .unwrap();
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn size_authorization_is_stored_in_the_lease_and_cannot_exceed_supported_kinds() {
        let dir = tempfile::tempdir().unwrap();
        let leases = ExportLeases::default();
        let ordinary = leases.insert("a", dir.path().join("ordinary.txt")).unwrap();
        let vault = leases
            .insert_bounded("a", dir.path().join("vault.json"), 100 * 1024 * 1024)
            .unwrap();
        assert_eq!(
            leases.claim("a", &ordinary).unwrap().max_size,
            64 * 1024 * 1024
        );
        assert_eq!(
            leases.claim("a", &vault).unwrap().max_size,
            100 * 1024 * 1024
        );
        assert!(leases
            .insert_bounded("a", dir.path().join("oversized"), 101 * 1024 * 1024)
            .is_err());
        assert!(prepare_bounded("synthetic", "YWJj", 2).is_err());
        assert!(prepare_bounded("synthetic", "YWJj", 3).is_ok());
        assert!(prepare_bounded("synthetic", "", 257 * 1024 * 1024).is_err());
        let mut permit = leases
            .insert("a", dir.path().join("bounded.txt"))
            .and_then(|uid| leases.claim("a", &uid))
            .unwrap();
        permit.max_size = 2;
        assert!(permit.write(b"abc").is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn knowledge_archive_budget_is_explicit() {
        let dir = tempfile::tempdir().unwrap();
        let leases = ExportLeases::default();
        let uid = leases.insert_bounded("a", dir.path().join("knowledge.zip"), 256 * 1024 * 1024).unwrap();
        assert!(leases.claim("b", &uid).is_err());
        let permit = leases.claim("a", &uid).unwrap();
        assert_eq!(permit.max_size, 256 * 1024 * 1024);
        assert!(prepare_bounded("knowledge.zip", "YWJj", permit.max_size).is_ok());
        assert!(leases.insert_bounded("a", dir.path().join("invalid.zip"), 257 * 1024 * 1024).is_err());
        leases.cancel("a", &uid).unwrap();
        assert!(permit.write(b"abc").is_err());
    }
    #[test]
    fn cancellation_after_claim_preserves_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("synthetic.txt");
        std::fs::write(&path, b"original").unwrap();
        let leases = ExportLeases::default();
        let uid = leases.insert("a", path.clone()).unwrap();
        let permit = leases.claim("a", &uid).unwrap();
        leases.cancel("a", &uid).unwrap();
        assert!(permit.write(b"replacement").is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"original");
    }
    #[test]
    fn cancellation_winning_publication_gate_preserves_original_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("synthetic.txt");
        std::fs::write(&path, b"original").unwrap();
        let publication = Arc::new(Mutex::new(()));
        let cancelled = Arc::new(AtomicBool::new(false));
        let guard = publication.lock().unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let writer_path = path.clone();
        let writer_gate = publication.clone();
        let writer_cancelled = cancelled.clone();
        let writer = std::thread::spawn(move || {
            let first = std::cell::Cell::new(true);
            write_atomic_guarded(
                &writer_path,
                b"replacement",
                || {
                    if first.replace(false) {
                        started_tx.send(()).unwrap();
                    }
                    !writer_cancelled.load(Ordering::SeqCst)
                },
                Some(&writer_gate),
            )
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        cancelled.store(true, Ordering::SeqCst);
        drop(guard);
        assert!(writer.join().unwrap().is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn poisoned_publication_gate_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("synthetic.txt");
        std::fs::write(&path, b"original").unwrap();
        let leases = ExportLeases::default();
        let uid = leases.insert("a", path.clone()).unwrap();
        let permit = leases.claim("a", &uid).unwrap();
        let gate = permit.publication.clone();
        let _ = std::thread::spawn(move || {
            let _guard = gate.lock().unwrap();
            panic!("synthetic failure");
        })
        .join();
        assert!(permit.write(b"replacement").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        leases.cancel("a", &uid).unwrap();
    }
    #[test]
    fn cancellation_before_publish_removes_staging() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("synthetic.txt");
        std::fs::write(&path, b"original").unwrap();
        let calls = std::cell::Cell::new(0);
        assert!(write_atomic_checked(&path, b"replacement", || {
            calls.set(calls.get() + 1);
            calls.get() == 1
        })
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

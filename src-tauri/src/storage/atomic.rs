use crate::errors::AppError;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const BACKUP_GENERATIONS: usize = 3;

const RENAME_RETRIES: u32 = 3;
const RENAME_RETRY_DELAY: Duration = Duration::from_millis(100);

#[derive(Debug, PartialEq, Eq)]
pub struct WriteOutcome {
    pub backup_path: Option<PathBuf>,
}

pub enum ValidateError {
    Content(String),
    Io(std::io::Error),
}

pub fn write_bytes_atomic(
    target: &Path,
    bytes: &[u8],
    backup: bool,
    validate: &dyn Fn(&Path) -> Result<(), ValidateError>,
) -> Result<WriteOutcome, AppError> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(io_err)?;
    }
    let tmp = sibling_temp_path(target);
    cleanup_orphan_tmp(&tmp);

    let write_result = (|| -> Result<(), AppError> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp)
            .map_err(io_err)?;
        file.write_all(bytes).map_err(io_err)?;
        file.sync_all().map_err(io_err)?;
        drop(file);

        validate(&tmp).map_err(|e| match e {
            ValidateError::Content(msg) => {
                AppError::new("VALIDATION_FAILED", "Записанные данные не прошли проверку")
                    .with_details(serde_json::json!({ "reason": msg }))
            }
            ValidateError::Io(err) => io_err(err),
        })
    })();
    if let Err(err) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(err);
    }

    let backup_path = if backup {
        rotate_backup(target).map_err(io_err)?
    } else {
        None
    };

    let mut last_err = None;
    for _ in 0..RENAME_RETRIES {
        match std::fs::rename(&tmp, target) {
            Ok(()) => {
                last_err = None;
                break;
            }
            Err(e) if transient(&e) => last_err = Some(e),
            Err(e) => {
                last_err = Some(e);
                break;
            }
        }
        std::thread::sleep(RENAME_RETRY_DELAY);
    }
    if let Some(e) = last_err {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::new(
            "WRITE_RENAME_FAILED",
            "Не удалось заменить файл новым содержимым. Предыдущая версия не тронута",
        )
        .with_details(serde_json::json!({ "error": e.to_string() })));
    }

    validate(target).map_err(|e| match e {
        ValidateError::Content(msg) => {
            AppError::new("WRITE_VERIFY_FAILED", "Файл после записи повреждён")
                .with_details(serde_json::json!({ "reason": msg }))
        }
        ValidateError::Io(err) => io_err(err),
    })?;

    Ok(WriteOutcome { backup_path })
}

pub fn write_json_atomic(
    target: &Path,
    value: &impl serde::Serialize,
    backup: bool,
) -> Result<WriteOutcome, AppError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| {
        AppError::new("SERIALIZATION_FAILED", "Не удалось сериализовать данные")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let validator = |p: &Path| -> Result<(), ValidateError> {
        let text = std::fs::read_to_string(p).map_err(ValidateError::Io)?;
        serde_json::from_str::<serde_json::Value>(&text)
            .map(|_| ())
            .map_err(|e| ValidateError::Content(e.to_string()))
    };
    write_bytes_atomic(target, &bytes, backup, &validator)
}

pub fn rotate_backup(target: &Path) -> std::io::Result<Option<PathBuf>> {
    if !target.is_file() {
        return Ok(None);
    }
    let oldest = backup_path(target, BACKUP_GENERATIONS);
    if oldest.is_file() {
        std::fs::remove_file(&oldest)?;
    }
    for i in (1..=BACKUP_GENERATIONS - 1).rev() {
        let from = backup_path(target, i);
        if from.is_file() {
            std::fs::rename(&from, backup_path(target, i + 1))?;
        }
    }
    let first = backup_path(target, 1);
    std::fs::copy(target, &first)?;
    Ok(Some(first))
}

fn backup_path(target: &Path, generation: usize) -> PathBuf {
    if generation == 1 {
        target.with_extension(format!(
            "{}.bak",
            target.extension().and_then(|e| e.to_str()).unwrap_or("")
        ))
    } else {
        target.with_extension(format!(
            "{}.bak.{generation}",
            target.extension().and_then(|e| e.to_str()).unwrap_or("")
        ))
    }
}

fn sibling_temp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    target.with_file_name(format!(
        "{name}.tmp-{uuid}",
        uuid = uuid::Uuid::new_v4().simple()
    ))
}

fn cleanup_orphan_tmp(_tmp: &Path) {}

pub fn cleanup_temp_files(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let (true, true) = (name.contains(".tmp-"), entry.path().is_file()) {
            if std::fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

fn transient(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock
    )
}

fn io_err(e: std::io::Error) -> AppError {
    AppError::new("IO_ERROR", "Ошибка доступа к файлам")
        .with_details(serde_json::json!({ "osError": e.to_string() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmpdir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("control-test-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn always_valid(_: &Path) -> Result<(), ValidateError> {
        Ok(())
    }

    #[test]
    fn atomic_write_creates_file() {
        let dir = tmpdir("create");
        let target = dir.join("a.json");
        let out = write_json_atomic(&target, &json!({"a": 1}), false).unwrap();
        assert!(out.backup_path.is_none());
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "{\n  \"a\": 1\n}"
        );
        assert_eq!(cleanup_temp_files(&dir), 0, "tmp не должен остаться");
    }

    #[test]
    fn failed_validation_leaves_old_file_intact() {
        let dir = tmpdir("invalid");
        let target = dir.join("a.json");
        std::fs::write(&target, "old").unwrap();
        let reject =
            |_: &Path| -> Result<(), ValidateError> { Err(ValidateError::Content("bad".into())) };
        let err = write_bytes_atomic(&target, b"new", false, &reject).unwrap_err();
        assert_eq!(err.code, "VALIDATION_FAILED");
        assert_eq!(std::fs::read(&target).unwrap(), b"old");
    }

    #[test]
    fn backup_rotation_keeps_history() {
        let dir = tmpdir("backup");
        let target = dir.join("s.json");
        std::fs::write(&target, "v1").unwrap();
        write_bytes_atomic(&target, b"v2", true, &always_valid).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"v2");
        assert_eq!(std::fs::read(backup_path(&target, 1)).unwrap(), b"v1");

        std::fs::write(&target, "v3").unwrap();
        write_bytes_atomic(&target, b"v4", true, &always_valid).unwrap();
        assert_eq!(std::fs::read(backup_path(&target, 1)).unwrap(), b"v3");
        assert_eq!(std::fs::read(backup_path(&target, 2)).unwrap(), b"v1");
    }

    #[test]
    fn no_backup_when_target_missing() {
        let dir = tmpdir("nobackup");
        let target = dir.join("new.json");
        let out = write_bytes_atomic(&target, b"data", true, &always_valid).unwrap();
        assert!(out.backup_path.is_none());
    }

    #[test]
    fn json_write_validates_written_content() {
        let dir = tmpdir("jsonval");
        let target = dir.join("x.json");
        write_json_atomic(&target, &json!({"k": "значение с кириллицей"}), false).unwrap();
        let read: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(read["k"], "значение с кириллицей");
    }
}

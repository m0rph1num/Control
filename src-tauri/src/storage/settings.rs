use crate::errors::AppError;
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::storage::atomic;
use crate::storage::locks::ResourceLocks;

#[derive(Debug, Clone)]
pub struct FileSnapshot {
    pub content: Value,
}

pub fn app_data_dir() -> Result<PathBuf, AppError> {
    let appdata = std::env::var("APPDATA").map_err(|_| {
        AppError::new(
            "ENV_MISSING",
            "Не найдена папка данных пользователя (%APPDATA%)",
        )
    })?;
    Ok(Path::new(&appdata).join("control"))
}

pub fn settings_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("settings.json"))
}

const SCHEMA_VERSION: u64 = 2;

pub fn migrate_legacy_settings() {
    let Ok(snapshot) = read_settings_recovering() else {
        return;
    };
    let Value::Object(mut content) = snapshot.content else {
        return;
    };
    if content.get("schemaVersion").and_then(Value::as_u64) == Some(SCHEMA_VERSION) {
        return;
    }
    content.remove("lastState");
    content.remove("advisor");
    content.remove("flowsealPath");
    content.insert("dataDirConfirmed".into(), Value::Bool(false));
    content.insert("schemaVersion".into(), Value::from(SCHEMA_VERSION));
    let Ok(path) = settings_path() else {
        return;
    };
    if let Err(error) = atomic::write_json_atomic(&path, &Value::Object(content), true) {
        tracing::warn!(%error.user_message, "не удалось перенести настройки на новую схему");
    }
}

pub fn flowseal_config_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("flowseal-config.json"))
}

fn parse_json(text: &str, path: &Path) -> Result<Value, AppError> {
    serde_json::from_str(text).map_err(|e| {
        AppError::new("SETTINGS_CORRUPT", "Файл настроек повреждён").with_details(
            serde_json::json!({ "path": path.to_string_lossy(), "error": e.to_string() }),
        )
    })
}

pub fn read_settings_recovering() -> Result<FileSnapshot, AppError> {
    read_json_recovering(&settings_path()?)
}

pub fn read_json_recovering(path: &Path) -> Result<FileSnapshot, AppError> {
    match std::fs::read_to_string(path) {
        Ok(text) => match parse_json(&text, path) {
            Ok(content) => Ok(FileSnapshot { content }),
            Err(err) => {
                let _ = preserve_corrupt(path);
                match restore_from_bak(path) {
                    Ok(content) => Ok(FileSnapshot { content }),
                    Err(_) => Err(err),
                }
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileSnapshot {
            content: Value::Null,
        }),
        Err(e) => Err(AppError::new("IO_ERROR", "Не удалось прочитать настройки")
            .with_details(serde_json::json!({ "error": e.to_string() }))),
    }
}

pub fn read_settings_raw() -> Result<Value, AppError> {
    read_settings_recovering().map(|s| s.content)
}

fn preserve_corrupt(path: &Path) -> Result<(), AppError> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let corrupt_dir = parent.join("corrupt");
    std::fs::create_dir_all(&corrupt_dir).map_err(io_err)?;
    let name = format!(
        "{}.{}.json",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    );
    std::fs::copy(path, corrupt_dir.join(name)).map_err(io_err)?;
    tracing::warn!(
        ?path,
        "повреждённый файл сохранён в corrupt/ для диагностики"
    );
    Ok(())
}

fn io_err(e: std::io::Error) -> AppError {
    AppError::new("IO_ERROR", "Ошибка доступа к файлам")
        .with_details(serde_json::json!({ "osError": e.to_string() }))
}

fn restore_from_bak(path: &Path) -> Result<Value, AppError> {
    let bak = path.with_extension("json.bak");
    let text = std::fs::read_to_string(&bak).map_err(|e| {
        AppError::new(
            "NO_BACKUP",
            "Повреждённый файл не удалось восстановить из .bak",
        )
        .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    parse_json(&text, &bak)
}

pub async fn write_json_checked(
    locks: &ResourceLocks,
    resource: &str,
    path: &Path,
    snapshot: &FileSnapshot,
    new_content: Value,
) -> Result<(), AppError> {
    locks
        .with_lock(resource, || async {
            match std::fs::read_to_string(path) {
                Ok(current) => {
                    let current_value: Value = serde_json::from_str(&current)
                        .map_err(|_| AppError::new("CONFLICT", "Файл изменён извне и повреждён"))?;
                    if current_value != snapshot.content {
                        return Err(AppError::new(
                            "CONFLICT",
                            "Файл изменён извне. Перечитайте данные и повторите действие",
                        ));
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    if !snapshot.content.is_null() {
                        return Err(AppError::new("CONFLICT", "Файл удалён извне после чтения"));
                    }
                }
                Err(e) => return Err(io_err(e)),
            }
            let mut content = new_content;
            if content.is_null() {
                content = Value::Object(serde_json::Map::new());
            }
            atomic::write_json_atomic(path, &content, true).map(|_| ())
        })
        .await
}

pub async fn write_settings_checked(
    locks: &ResourceLocks,
    snapshot: &FileSnapshot,
    new_content: Value,
) -> Result<(), AppError> {
    write_json_checked(locks, "settings", &settings_path()?, snapshot, new_content).await
}

pub async fn write_flowseal_config(locks: &ResourceLocks, content: &Value) -> Result<(), AppError> {
    locks
        .with_lock("flowseal-config", || async {
            let path = flowseal_config_path()?;
            atomic::write_json_atomic(&path, content, true).map(|_| ())
        })
        .await
}

pub fn read_flowseal_config() -> Result<Value, AppError> {
    let path = flowseal_config_path()?;
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_json(&text, &path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(e) => Err(
            AppError::new("IO_ERROR", "Не удалось прочитать конфигурацию")
                .with_details(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

pub fn notifications_enabled() -> bool {
    read_settings_raw()
        .ok()
        .and_then(|settings| settings.get("notifications").and_then(Value::as_bool))
        .unwrap_or(true)
}

pub fn settings_str<'a>(settings: &'a Value, key: &str) -> Option<&'a str> {
    settings
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

pub fn find_flowseal_dir(settings: &Value) -> Option<PathBuf> {
    if let (Some(control_dir), Some(selected)) = (
        settings_str(settings, "controlDir"),
        settings_str(settings, "selectedVersion"),
    ) {
        let candidate = Path::new(control_dir).join(selected);
        if candidate.join("bin").join("winws.exe").is_file() {
            return Some(candidate);
        }
    }
    if let Some(explicit) = settings_str(settings, "flowsealPath") {
        let p = PathBuf::from(explicit);
        if p.join("bin").join("winws.exe").is_file() {
            return Some(p);
        }
    }
    if let Some(control_dir) = settings_str(settings, "controlDir") {
        let mut versions: Vec<PathBuf> = std::fs::read_dir(control_dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir() && p.join("bin").join("winws.exe").is_file())
            .collect();
        versions.sort();
        versions.reverse();
        return versions.into_iter().next();
    }
    None
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyInfo {
    pub value: String,
    pub filename: String,
    pub label: String,
    pub path: PathBuf,

    pub kind: String,
}

pub fn list_strategies(dir: &Path) -> Vec<StrategyInfo> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let filename = entry.file_name().to_string_lossy().into_owned();
        if !filename.to_lowercase().ends_with(".bat") {
            continue;
        }
        if filename.to_lowercase().starts_with("service") {
            continue;
        }
        let base_len = filename.len() - 4;
        let base = filename[..base_len].to_string();
        result.push(StrategyInfo {
            value: base.clone(),
            filename: filename.clone(),
            label: build_label(&base),
            path: entry.path(),
            kind: "version".into(),
        });
    }
    result.sort_by(|a, b| a.value.cmp(&b.value));
    result
}

fn build_label(base: &str) -> String {
    let cleaned = base
        .strip_prefix("general")
        .map(str::trim_start)
        .unwrap_or(base)
        .replace(['(', ')'], "")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        "Default".to_string()
    } else {
        cleaned
    }
}

pub fn game_filter_mode(dir: &Path) -> crate::domain::strategy::GameFilterMode {
    use crate::domain::strategy::GameFilterMode;
    match std::fs::read_to_string(dir.join("utils").join("game_filter.enabled")) {
        Ok(text) => match text.trim().to_lowercase().as_str() {
            "all" => GameFilterMode::All,
            "tcp" => GameFilterMode::Tcp,
            "udp" => GameFilterMode::Udp,
            _ => GameFilterMode::Disabled,
        },
        Err(_) => GameFilterMode::Disabled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_label_like_reference() {
        assert_eq!(build_label("general (simple fake alt)"), "simple fake alt");
        assert_eq!(build_label("general"), "Default");
        assert_eq!(build_label("multidisorder"), "multidisorder");
    }

    #[test]
    fn find_flowseal_dir_prefers_selected_version() {
        let settings = serde_json::json!({
            "controlDir": "C:\\zapret",
            "selectedVersion": "v9.9.9"
        });

        assert_eq!(find_flowseal_dir(&settings), None);
    }

    #[test]
    fn read_settings_raw_missing_file_is_null() {
        if std::env::var("APPDATA").is_ok() {
            let _ = read_settings_raw();
        }
    }

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("control-st-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    use std::sync::Arc;

    #[tokio::test]
    async fn corrupt_settings_recovers_from_bak() {
        let dir = tmpdir("corrupt");
        let path = dir.join("settings.json");
        std::fs::write(&path, "{ broken json").unwrap();
        std::fs::write(dir.join("settings.json.bak"), r#"{"recovered": true}"#).unwrap();

        let snap = read_json_recovering(&path).unwrap();
        assert_eq!(snap.content["recovered"], true);

        let corrupt_dir = dir.join("corrupt");
        assert!(std::fs::read_dir(&corrupt_dir).unwrap().count() >= 1);
    }

    #[tokio::test]
    async fn corrupt_settings_without_bak_returns_error() {
        let dir = tmpdir("nobak");
        let path = dir.join("settings.json");
        std::fs::write(&path, "{ broken").unwrap();

        let err = read_json_recovering(&path).unwrap_err();
        assert_eq!(err.code, "SETTINGS_CORRUPT");

        assert!(path.is_file());
    }

    #[tokio::test]
    async fn conflict_detected_on_external_modification() {
        let dir = tmpdir("conflict");
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"v": 1}"#).unwrap();

        let snapshot = read_json_recovering(&path).unwrap();

        std::fs::write(&path, r#"{"v": 2, "external": true}"#).unwrap();

        let err = write_json_checked(
            &ResourceLocks::new(),
            "test",
            &path,
            &snapshot,
            serde_json::json!({"v": 3}),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, "CONFLICT");

        let now: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(now["external"], true);
    }

    #[tokio::test]
    async fn concurrent_writes_are_serialized() {
        let dir = tmpdir("conc");
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"n": 0}"#).unwrap();
        let locks = Arc::new(ResourceLocks::new());

        let mut tasks = Vec::new();
        for _ in 0..20 {
            let locks_ref = locks.clone();
            let path = path.clone();
            tasks.push(tokio::spawn(async move {
                let snap = read_json_recovering(&path).unwrap();
                let mut n = snap.content["n"].as_i64().unwrap_or(0);
                n += 1;
                write_json_checked(
                    &locks_ref,
                    "conc-test",
                    &path,
                    &snap,
                    serde_json::json!({"n": n}),
                )
                .await
                .unwrap();
            }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        let final_v: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(final_v["n"], 20);
    }

    #[tokio::test]
    async fn unknown_keys_survive_roundtrip() {
        let dir = tmpdir("roundtrip");
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{"known": 1, "unknownFromFuture": {"x": 2}}"#).unwrap();

        let snapshot = read_json_recovering(&path).unwrap();
        let mut updated = snapshot.content.clone();
        updated["known"] = serde_json::json!(2);
        write_json_checked(&ResourceLocks::new(), "rt", &path, &snapshot, updated)
            .await
            .unwrap();

        let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["known"], 2);
        assert_eq!(
            after["unknownFromFuture"]["x"], 2,
            "неизвестные ключи сохранены"
        );
    }
}

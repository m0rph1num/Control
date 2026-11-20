use crate::errors::AppError;
use crate::storage::atomic;
use serde::Serialize;
use std::path::{Path, PathBuf};

fn validate_preset_name(name: &str) -> Result<(), AppError> {
    let ok_len = !name.is_empty() && name.chars().count() <= 64;
    let ok_chars = name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == ' ');
    if ok_len && ok_chars {
        Ok(())
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            "Имя пресета: 1–64 символа, буквы/цифры/пробел/_/-",
        ))
    }
}

pub fn presets_dir() -> Result<PathBuf, AppError> {
    let dir = crate::storage::settings::app_data_dir()?.join("presets");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать папку пресетов")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(dir)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub name: String,
    pub filename: String,
    pub content: String,
}

pub fn list() -> Result<Vec<Preset>, AppError> {
    list_in(&presets_dir()?)
}

fn list_in(dir: &Path) -> Result<Vec<Preset>, AppError> {
    let mut result = Vec::new();
    for entry in std::fs::read_dir(dir)
        .map_err(|e| {
            AppError::new("IO_ERROR", "Не удалось прочитать папку пресетов")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
        .flatten()
    {
        let filename = entry.file_name().to_string_lossy().into_owned();
        let lower = filename.to_lowercase();
        if !lower.ends_with(".bat") {
            continue;
        }
        let name = filename[..filename.len() - 4].to_string();
        if validate_preset_name(&name).is_err() {
            continue;
        }
        let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        result.push(Preset {
            name,
            filename,
            content,
        });
    }
    result.sort_by_key(|p| p.name.to_lowercase());
    Ok(result)
}

pub fn read(name: &str) -> Result<Preset, AppError> {
    read_in(&presets_dir()?, name)
}

fn read_in(dir: &Path, name: &str) -> Result<Preset, AppError> {
    validate_preset_name(name)?;
    let path = dir.join(format!("{name}.bat"));
    let content = std::fs::read_to_string(&path).map_err(|e| {
        AppError::new("NOT_FOUND", "Пресет не найден")
            .with_details(serde_json::json!({ "osError": e.to_string() }))
    })?;
    Ok(Preset {
        name: name.to_string(),
        filename: format!("{name}.bat"),
        content,
    })
}

pub fn save(name: &str, content: &str) -> Result<(), AppError> {
    save_in(&presets_dir()?, name, content)
}

fn save_in(dir: &Path, name: &str, content: &str) -> Result<(), AppError> {
    validate_preset_name(name)?;
    if content.len() > 1024 * 1024 {
        return Err(AppError::new(
            "TOO_LARGE",
            "Пресет слишком велик (лимит 1 МБ)",
        ));
    }

    let parsed = crate::domain::strategy::parse_strategy_args(
        content,
        Path::new("C:\\zapret"),
        crate::domain::strategy::GameFilterMode::Disabled,
    );
    if parsed.args.is_empty() {
        return Err(AppError::new(
            "INVALID_PRESET",
            "В пресете не найдены аргументы winws.exe — проверьте формат .bat",
        ));
    }
    let path = dir.join(format!("{name}.bat"));
    let validate = |p: &Path| -> Result<(), atomic::ValidateError> {
        std::fs::read_to_string(p)
            .map_err(atomic::ValidateError::Io)
            .and_then(|t| {
                if t == content {
                    Ok(())
                } else {
                    Err(atomic::ValidateError::Content("mismatch".into()))
                }
            })
    };
    atomic::write_bytes_atomic(&path, content.as_bytes(), false, &validate).map(|_| ())
}

pub fn delete(name: &str) -> Result<(), AppError> {
    delete_in(&presets_dir()?, name)
}

fn delete_in(dir: &Path, name: &str) -> Result<(), AppError> {
    validate_preset_name(name)?;
    let path = dir.join(format!("{name}.bat"));
    if !path.is_file() {
        return Err(AppError::new("NOT_FOUND", "Пресет не найден"));
    }
    std::fs::remove_file(&path).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось удалить пресет")
            .with_details(serde_json::json!({ "osError": e.to_string() }))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_name_validation() {
        assert!(validate_preset_name("Моя игра 2").is_ok());
        assert!(validate_preset_name("cs2-udp").is_ok());
        assert_eq!(
            validate_preset_name("../evil").unwrap_err().code,
            "INVALID_ARGUMENT"
        );
        assert_eq!(
            validate_preset_name("").unwrap_err().code,
            "INVALID_ARGUMENT"
        );
        assert_eq!(
            validate_preset_name("x\\y").unwrap_err().code,
            "INVALID_ARGUMENT"
        );
    }

    #[test]
    fn preset_save_list_delete_roundtrip() {
        let dir = std::env::temp_dir().join(format!("control-presets-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let before = list_in(&dir).unwrap().len();
        let content = "@echo off\r\nstart \"winws\" \"%~dp0bin\\winws.exe\" --wf-tcp=443 --wf-udp=443 --gsid=3\r\n";
        save_in(&dir, "test-preset-1", content).unwrap();
        let presets = list_in(&dir).unwrap();
        assert_eq!(presets.len(), before + 1);
        let found = presets.iter().find(|p| p.name == "test-preset-1").unwrap();
        assert_eq!(found.content, content);
        assert_eq!(read_in(&dir, "test-preset-1").unwrap().content, content);

        assert_eq!(
            save_in(&dir, "bad", "echo hi").unwrap_err().code,
            "INVALID_PRESET"
        );

        delete_in(&dir, "test-preset-1").unwrap();
        assert_eq!(
            read_in(&dir, "test-preset-1").unwrap_err().code,
            "NOT_FOUND"
        );

        std::fs::write(dir.join("trojan.txt"), "x").unwrap();
        assert_eq!(list_in(&dir).unwrap().len(), before);

        let _ = std::fs::remove_dir_all(&dir);
    }
}

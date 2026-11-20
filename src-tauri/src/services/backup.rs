use crate::errors::AppError;
use crate::storage::atomic;
use crate::storage::locks::ResourceLocks;
use crate::storage::settings;
use serde_json::{json, Value};
use std::path::Path;

pub const BUNDLE_APP_MARKER: &str = "Control";

pub fn build_bundle() -> Result<Value, AppError> {
    let snapshot = settings::read_settings_recovering()?;
    let flowseal = settings::read_flowseal_config().unwrap_or(Value::Null);

    let user_lists = match settings::find_flowseal_dir(&snapshot.content) {
        Some(dir) => {
            let lists = crate::services::filters::lists_get(&dir)?;
            let mut map = serde_json::Map::new();
            for list in lists {
                map.insert(list.key.clone(), json!(list.content));
            }
            Value::Object(map)
        }
        None => json!({}),
    };

    Ok(json!({
        "app": BUNDLE_APP_MARKER,
        "settings": snapshot.content,
        "flowsealConfig": flowseal,
        "userLists": user_lists,
    }))
}

pub fn export_to(path: &Path, bundle: &Value) -> Result<(), AppError> {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        != Some("json".into())
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Файл backup должен быть .json",
        ));
    }
    atomic::write_json_atomic(path, bundle, false).map(|_| ())
}

fn validate_bundle(raw: &Value) -> Result<(), AppError> {
    if raw.get("app").and_then(Value::as_str) != Some(BUNDLE_APP_MARKER) {
        return Err(AppError::new(
            "INVALID_BACKUP",
            "Это не файл резервной копии Control",
        ));
    }
    if !raw.get("settings").is_none_or(|v| v.is_object()) {
        return Err(AppError::new(
            "INVALID_BACKUP",
            "Секция settings повреждена",
        ));
    }
    if let Some(flowseal) = raw.get("flowsealConfig") {
        if !flowseal.is_object() && !flowseal.is_null() {
            return Err(AppError::new(
                "INVALID_BACKUP",
                "Секция flowsealConfig повреждена",
            ));
        }
    }
    if let Some(lists) = raw.get("userLists") {
        if !lists.is_object() {
            return Err(AppError::new(
                "INVALID_BACKUP",
                "Секция userLists повреждена",
            ));
        }
        for (k, v) in lists.as_object().unwrap() {
            if crate::services::filters::LIST_FILES
                .iter()
                .all(|(key, _, _)| key != k)
            {
                return Err(AppError::new(
                    "INVALID_BACKUP",
                    format!("Неизвестный список в backup: {k}"),
                ));
            }
            if !v.is_string() {
                return Err(AppError::new(
                    "INVALID_BACKUP",
                    "Содержимое списка должно быть строкой",
                ));
            }
        }
    }
    Ok(())
}

pub async fn import_from(path: &Path, locks: &ResourceLocks) -> Result<(), AppError> {
    let raw_text = std::fs::read_to_string(path).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось прочитать файл backup")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let raw: Value = serde_json::from_str(&raw_text).map_err(|e| {
        AppError::new("INVALID_BACKUP", "Файл backup повреждён")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    validate_bundle(&raw)?;

    let snapshot = settings::read_settings_recovering()?;
    let mut new_settings = raw
        .get("settings")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Some(last_state) = snapshot.content.get("lastState") {
        new_settings.insert("lastState".into(), last_state.clone());
    }
    settings::write_settings_checked(locks, &snapshot, Value::Object(new_settings)).await?;

    if let Some(flowseal) = raw.get("flowsealConfig").filter(|v| v.is_object()) {
        settings::write_flowseal_config(locks, flowseal).await?;
    }

    if let Some(lists) = raw.get("userLists").and_then(Value::as_object) {
        if !lists.is_empty() {
            let current = settings::read_settings_raw()?;
            if let Some(dir) = settings::find_flowseal_dir(&current) {
                for (key, value) in lists {
                    crate::services::filters::list_write(
                        &dir,
                        key,
                        value.as_str().unwrap_or_default(),
                    )?;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_foreign_files() {
        assert_eq!(
            validate_bundle(&json!({"app": "SomethingElse"}))
                .unwrap_err()
                .code,
            "INVALID_BACKUP"
        );
        assert_eq!(
            validate_bundle(&json!({})).unwrap_err().code,
            "INVALID_BACKUP"
        );
    }

    #[test]
    fn accepts_valid_bundle_and_rejects_bad_lists() {
        let good = json!({
            "app": "Control",
            "settings": {"controlDir": "C:\\x"},
            "flowsealConfig": {"strategy": "general"},
            "userLists": {"generalUser": "content"}
        });
        assert!(validate_bundle(&good).is_ok());

        let bad = json!({
            "app": "Control",
            "userLists": {"unknownList": "x"}
        });
        assert_eq!(validate_bundle(&bad).unwrap_err().code, "INVALID_BACKUP");
    }
}

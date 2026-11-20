use crate::domain::strategy::GameFilterMode;
use crate::errors::AppError;
use crate::services::filters::{self, IpsetMode};
use crate::storage::atomic;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const PROFILE_FORMAT: &str = "control-profile-1";

fn validate_id(id: &str) -> Result<(), AppError> {
    let ok = (8..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            "Некорректный идентификатор профиля",
        ))
    }
}

fn validate_name(name: &str) -> Result<(), AppError> {
    let ok_len = !name.trim().is_empty() && name.chars().count() <= 64;
    let ok_chars = name
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '(' | ')' | '.' | '+'));
    if ok_len && ok_chars {
        Ok(())
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            "Имя профиля: 1–64 символа, буквы/цифры/пробел/_-(). +",
        ))
    }
}

fn validate_strategy(strategy: &str) -> Result<(), AppError> {
    if strategy.is_empty()
        || strategy.contains('\\')
        || strategy.contains('/')
        || strategy.contains("..")
        || strategy.contains('\0')
        || strategy.chars().count() > 128
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Некорректная стратегия профиля",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFakes {
    #[serde(default)]
    pub discord: Option<String>,
    #[serde(default)]
    pub game: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub strategy: String,
    #[serde(default)]
    pub game_filter: GameFilterMode,
    #[serde(default)]
    pub ipset: IpsetMode,
    #[serde(default)]
    pub fakes: ProfileFakes,

    #[serde(default)]
    pub lists: BTreeMap<String, String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,

    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "local".into()
}

impl Default for Profile {
    fn default() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            strategy: String::new(),
            game_filter: GameFilterMode::Disabled,
            ipset: IpsetMode::Loaded,
            fakes: ProfileFakes::default(),
            lists: BTreeMap::new(),
            created_at: now.clone(),
            updated_at: now,
            source: default_source(),
        }
    }
}

pub fn profiles_dir() -> Result<PathBuf, AppError> {
    let dir = crate::storage::settings::app_data_dir()?.join("profiles");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать папку профилей")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(dir)
}

fn profile_path(dir: &Path, id: &str) -> Result<PathBuf, AppError> {
    validate_id(id)?;
    Ok(dir.join(format!("{id}.json")))
}

pub fn list() -> Result<Vec<Profile>, AppError> {
    list_in(&profiles_dir()?)
}

fn list_in(dir: &Path) -> Result<Vec<Profile>, AppError> {
    let mut result = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| {
            AppError::new("IO_ERROR", "Не удалось прочитать папку профилей")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
        .flatten();
    for entry in entries {
        let path = entry.path();
        if !path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("json"))
        {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(profile) = serde_json::from_str::<Profile>(&text) else {
            continue;
        };
        if validate_id(&profile.id).is_err() || validate_name(&profile.name).is_err() {
            continue;
        }
        result.push(profile);
    }
    result.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(result)
}

pub fn get(id: &str) -> Result<Profile, AppError> {
    get_in(&profiles_dir()?, id)
}

fn get_in(dir: &Path, id: &str) -> Result<Profile, AppError> {
    let path = profile_path(dir, id)?;
    let text = std::fs::read_to_string(&path).map_err(|e| {
        AppError::new("NOT_FOUND", "Профиль не найден")
            .with_details(serde_json::json!({ "osError": e.to_string() }))
    })?;
    serde_json::from_str(&text).map_err(|e| {
        AppError::new("PROFILE_CORRUPT", "Файл профиля повреждён")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })
}

pub fn save(mut profile: Profile) -> Result<Profile, AppError> {
    save_in(&profiles_dir()?, &mut profile)
}

fn save_in(dir: &Path, profile: &mut Profile) -> Result<Profile, AppError> {
    validate_name(&profile.name)?;
    validate_strategy(&profile.strategy)?;
    if profile.description.chars().count() > 500 {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Описание слишком длинное",
        ));
    }
    let total_lists: usize = profile.lists.values().map(String::len).sum();
    if total_lists > 24 * 1024 * 1024 {
        return Err(AppError::new("TOO_LARGE", "Списки профиля слишком велики"));
    }
    for key in profile.lists.keys() {
        if !filters::LIST_FILES.iter().any(|(k, _, _)| k == key) {
            return Err(AppError::new("INVALID_ARGUMENT", "Неизвестный ключ списка"));
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    if profile.id.is_empty() {
        profile.id = uuid::Uuid::new_v4().to_string();
        profile.created_at = now.clone();
        profile.source = default_source();
    } else {
        validate_id(&profile.id)?;

        if let Ok(existing) = get_in(dir, &profile.id) {
            if profile.created_at.is_empty() {
                profile.created_at = existing.created_at;
            }
        }
    }
    if profile.created_at.is_empty() {
        profile.created_at = now.clone();
    }
    profile.updated_at = now;

    let path = dir.join(format!("{}.json", profile.id));
    let bytes = serde_json::to_vec_pretty(profile).map_err(|e| {
        AppError::new("INTERNAL", "Не удалось сериализовать профиль")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let expected = profile.updated_at.clone();
    let validate = |p: &Path| -> Result<(), atomic::ValidateError> {
        let text = std::fs::read_to_string(p).map_err(atomic::ValidateError::Io)?;
        let parsed: Profile = serde_json::from_str(&text)
            .map_err(|_| atomic::ValidateError::Content("json".into()))?;
        if parsed.updated_at == expected {
            Ok(())
        } else {
            Err(atomic::ValidateError::Content("mismatch".into()))
        }
    };
    atomic::write_bytes_atomic(&path, &bytes, false, &validate)?;
    Ok(profile.clone())
}

pub fn delete(id: &str) -> Result<(), AppError> {
    delete_in(&profiles_dir()?, id)
}

fn delete_in(dir: &Path, id: &str) -> Result<(), AppError> {
    let path = profile_path(dir, id)?;
    if !path.is_file() {
        return Err(AppError::new("NOT_FOUND", "Профиль не найден"));
    }
    std::fs::remove_file(&path).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось удалить профиль")
            .with_details(serde_json::json!({ "osError": e.to_string() }))
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedProfile {
    pub strategy: String,

    pub live_applied: bool,
}

pub async fn apply(
    profile: &Profile,
    state: &crate::state::AppState,
) -> Result<AppliedProfile, AppError> {
    validate_strategy(&profile.strategy)?;
    let settings = crate::storage::settings::read_settings_raw()?;
    let dir = crate::storage::settings::find_flowseal_dir(&settings).ok_or_else(|| {
        AppError::new(
            "NO_ZAPRET_INSTALL",
            "Установка Zapret не найдена. Установите или выберите версию",
        )
    })?;

    filters::game_filter_set(&dir, profile.game_filter)?;
    filters::ipset_filter_set(&dir, profile.ipset)?;
    if let Some(fake) = profile.fakes.discord.as_deref() {
        if !fake.is_empty() {
            filters::fake_set(&dir, "discord", fake)?;
        }
    }
    if let Some(fake) = profile.fakes.game.as_deref() {
        if !fake.is_empty() {
            filters::fake_set(&dir, "game", fake)?;
        }
    }
    for (key, content) in &profile.lists {
        filters::list_write(&dir, key, content)?;
    }

    let strategy_path = match profile.strategy.strip_prefix("preset:") {
        Some(name) => {
            crate::services::presets::read(name)?;
            crate::services::presets::presets_dir()?.join(format!("{name}.bat"))
        }
        None => dir.join(format!("{}.bat", profile.strategy)),
    };
    if !strategy_path.is_file() {
        return Err(AppError::new(
            "STRATEGY_NOT_FOUND",
            "Стратегия профиля не найдена в выбранной версии. Проверьте версию Zapret",
        ));
    }
    let game_mode = crate::storage::settings::game_filter_mode(&dir);
    let live = state
        .control
        .reconfigure_with(strategy_path, dir, game_mode)
        .await?;
    Ok(AppliedProfile {
        strategy: profile.strategy.clone(),
        live_applied: live,
    })
}

pub fn export_text(id: &str) -> Result<String, AppError> {
    let profile = get(id)?;
    let mut value = serde_json::to_value(&profile).map_err(|e| {
        AppError::new("INTERNAL", "Не удалось сериализовать профиль")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "format".into(),
            serde_json::Value::String(PROFILE_FORMAT.into()),
        );
    }
    serde_json::to_string_pretty(&value).map_err(|e| {
        AppError::new("INTERNAL", "Не удалось сериализовать профиль")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })
}

pub fn export_file(path: &Path, id: &str) -> Result<(), AppError> {
    let is_json = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !is_json {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Файл профиля должен иметь расширение .json",
        ));
    }
    let text = export_text(id)?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::new("IO_ERROR", "Не удалось создать папку для файла профиля")
                    .with_details(serde_json::json!({ "osError": e.to_string() }))
            })?;
        }
    }
    std::fs::write(path, text).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось записать файл профиля")
            .with_details(serde_json::json!({ "osError": e.to_string() }))
    })
}

pub fn import_text(text: &str) -> Result<Profile, AppError> {
    if text.len() > 25 * 1024 * 1024 {
        return Err(AppError::new("TOO_LARGE", "Файл профиля слишком велик"));
    }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| {
        AppError::new("PROFILE_INVALID", "Это не похоже на профиль Control")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let payload = value.get("profile").cloned().unwrap_or(value);
    let mut profile: Profile = serde_json::from_value(payload).map_err(|e| {
        AppError::new("PROFILE_INVALID", "Профиль имеет неверный формат")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;

    profile.id.clear();
    profile.source = "imported".into();
    save(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_roundtrip_in_temp_dir() {
        let dir = std::env::temp_dir().join(format!("control-profiles-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut profile = Profile {
            name: "Тест".into(),
            strategy: "general.bat".into(),
            description: "демо".into(),
            ..Default::default()
        };
        let saved = save_in(&dir, &mut profile).unwrap();
        let loaded = get_in(&dir, &saved.id).unwrap();
        assert_eq!(loaded.name, "Тест");
        assert_eq!(loaded.strategy, "general.bat");
        assert_eq!(list_in(&dir).unwrap().len(), 1);
        delete_in(&dir, &saved.id).unwrap();
        assert_eq!(get_in(&dir, &saved.id).unwrap_err().code, "NOT_FOUND");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_bad_names_and_paths() {
        let mut profile = Profile {
            name: "..".into(),
            strategy: "../evil".into(),
            ..Default::default()
        };
        let dir = std::env::temp_dir();
        assert_eq!(
            save_in(&dir, &mut profile).unwrap_err().code,
            "INVALID_ARGUMENT"
        );
    }
}

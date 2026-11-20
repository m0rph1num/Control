use crate::domain::strategy::GameFilterMode;
use crate::errors::AppError;
use crate::storage::atomic;
use serde::Serialize;
use std::path::Path;

pub const LIST_FILES: &[(&str, &str, &str)] = &[
    (
        "generalUser",
        "list-general-user.txt",
        "Пользовательский список доменов",
    ),
    (
        "excludeUser",
        "list-exclude-user.txt",
        "Пользовательский список исключений",
    ),
    (
        "ipsetExcludeUser",
        "ipset-exclude-user.txt",
        "Пользовательский IPSet исключений",
    ),
];

fn list_file(key: &str) -> Option<&'static str> {
    LIST_FILES
        .iter()
        .find(|(k, _, _)| *k == key)
        .map(|(_, f, _)| *f)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserList {
    pub key: String,
    pub filename: String,
    pub label: String,
    pub content: String,
    pub exists: bool,
}

pub fn lists_get(dir: &Path) -> Result<Vec<UserList>, AppError> {
    let lists_dir = dir.join("lists");
    LIST_FILES
        .iter()
        .map(|(key, file, label)| {
            let path = lists_dir.join(file);
            let (content, exists) = match std::fs::read_to_string(&path) {
                Ok(text) => (text, true),
                Err(_) => (String::new(), false),
            };
            Ok(UserList {
                key: key.to_string(),
                filename: file.to_string(),
                label: label.to_string(),
                content,
                exists,
            })
        })
        .collect()
}

pub fn list_write(dir: &Path, key: &str, content: &str) -> Result<(), AppError> {
    let file =
        list_file(key).ok_or_else(|| AppError::new("INVALID_ARGUMENT", "Неизвестный список"))?;
    if content.len() > 16 * 1024 * 1024 {
        return Err(AppError::new(
            "TOO_LARGE",
            "Список слишком велик (лимит 16 МБ)",
        ));
    }
    let path = dir.join("lists").join(file);

    let validate = |p: &Path| -> Result<(), atomic::ValidateError> {
        std::fs::read(p).map_err(atomic::ValidateError::Io)?;
        Ok(())
    };
    atomic::write_bytes_atomic(&path, content.as_bytes(), false, &validate).map(|_| ())
}

pub fn game_filter_set(dir: &Path, mode: GameFilterMode) -> Result<(), AppError> {
    let utils_dir = dir.join("utils");
    if !utils_dir.is_dir() {
        return Err(AppError::new(
            "NO_UTILS_DIR",
            "В установленной версии нет папки utils. Переустановите версию",
        ));
    }
    let flag = utils_dir.join("game_filter.enabled");
    match mode {
        GameFilterMode::Disabled => {
            if flag.is_file() {
                std::fs::remove_file(&flag).map_err(atomic_io)?;
            }
            Ok(())
        }
        mode => {
            let text = match mode {
                GameFilterMode::All => "all",
                GameFilterMode::Tcp => "tcp",
                GameFilterMode::Udp => "udp",
                GameFilterMode::Disabled => unreachable!(),
            };
            let validate = |p: &Path| -> Result<(), atomic::ValidateError> {
                let t = std::fs::read_to_string(p).map_err(atomic::ValidateError::Io)?;
                if t.trim() == text {
                    Ok(())
                } else {
                    Err(atomic::ValidateError::Content("flag mismatch".into()))
                }
            };
            atomic::write_bytes_atomic(&flag, text.as_bytes(), false, &validate).map(|_| ())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum IpsetMode {
    #[default]
    Loaded,
    Any,
    None,
}

pub fn ipset_mode_get(dir: &Path) -> IpsetMode {
    let list_file = dir.join("lists").join("ipset-all.txt");
    match std::fs::read_to_string(&list_file) {
        Ok(text) => {
            let t = text.trim();
            if t.is_empty() {
                IpsetMode::Any
            } else if t.contains("203.0.113.113") {
                IpsetMode::None
            } else {
                IpsetMode::Loaded
            }
        }
        Err(_) => IpsetMode::Loaded,
    }
}

pub fn ipset_filter_set(dir: &Path, mode: IpsetMode) -> Result<(), AppError> {
    let lists_dir = dir.join("lists");
    if !lists_dir.is_dir() {
        return Err(AppError::new(
            "NO_LISTS_DIR",
            "В установленной версии нет папки lists. Переустановите версию",
        ));
    }
    let list_file = lists_dir.join("ipset-all.txt");
    let backup_file = lists_dir.join("ipset-all.txt.backup");

    if mode == IpsetMode::Loaded {
        if backup_file.is_file() {
            let bytes = std::fs::read(&backup_file).map_err(atomic_io)?;
            let validate = |p: &Path| -> Result<(), atomic::ValidateError> {
                let read = std::fs::read(p).map_err(atomic::ValidateError::Io)?;
                if read == bytes {
                    Ok(())
                } else {
                    Err(atomic::ValidateError::Content("mismatch".into()))
                }
            };
            atomic::write_bytes_atomic(&list_file, &bytes, false, &validate).map(|_| ())?;
        }
        return Ok(());
    }

    let content: &[u8] = match mode {
        IpsetMode::None => b"203.0.113.113/32\n",
        IpsetMode::Any => b"",
        IpsetMode::Loaded => unreachable!("обработан выше"),
    };

    if list_file.is_file() && !backup_file.is_file() {
        std::fs::copy(&list_file, &backup_file).map_err(atomic_io)?;
    }
    let validate = |p: &Path| -> Result<(), atomic::ValidateError> {
        let read = std::fs::read(p).map_err(atomic::ValidateError::Io)?;
        if read == content {
            Ok(())
        } else {
            Err(atomic::ValidateError::Content("mismatch".into()))
        }
    };
    atomic::write_bytes_atomic(&list_file, content, false, &validate).map(|_| ())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FakesInfo {
    pub fakes: Vec<String>,
    pub current_discord: Option<String>,
    pub current_game: Option<String>,
}

pub fn fakes_get(dir: &Path) -> FakesInfo {
    let bin_dir = dir.join("bin");
    let mut fakes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&bin_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.to_lowercase().ends_with(".bin") && !name.starts_with("ACTIVE_") {
                fakes.push(name.trim_end_matches(".bin").to_string());
            }
        }
    }
    fakes.sort();
    let active_of = |file: &str| -> Option<String> {
        let p = bin_dir.join(file);
        if p.is_file() {
            Some(String::new())
        } else {
            None
        }
    };

    let current_discord = active_fake(&bin_dir, "ACTIVE_DISCORD_UDP.bin", &fakes);
    let current_game = active_fake(&bin_dir, "ACTIVE_GAME_UDP.bin", &fakes);
    FakesInfo {
        fakes,
        current_discord: current_discord
            .or_else(|| active_of("ACTIVE_DISCORD_UDP.bin").map(|_| String::new())),
        current_game: current_game
            .or_else(|| active_of("ACTIVE_GAME_UDP.bin").map(|_| String::new())),
    }
}

fn active_fake(bin_dir: &Path, active_file: &str, fakes: &[String]) -> Option<String> {
    let active = bin_dir.join(active_file);
    if !active.is_file() {
        return None;
    }
    let active_hash = sha256_hex(&std::fs::read(&active).ok()?);
    fakes
        .iter()
        .find(|f| {
            std::fs::read(bin_dir.join(format!("{f}.bin")))
                .ok()
                .map(|b| sha256_hex(&b) == active_hash)
                .unwrap_or(false)
        })
        .cloned()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub fn fake_set(dir: &Path, fake_type: &str, fake_name: &str) -> Result<(), AppError> {
    let bin_dir = dir.join("bin");
    if !bin_dir.is_dir() {
        return Err(AppError::new("NO_BIN_DIR", "В версии нет папки bin"));
    }
    let target = match fake_type {
        "discord" => "ACTIVE_DISCORD_UDP.bin",
        "game" => "ACTIVE_GAME_UDP.bin",
        _ => return Err(AppError::new("INVALID_ARGUMENT", "Неизвестный тип fake")),
    };

    if !fakes_get(dir).fakes.iter().any(|f| f == fake_name) {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Такого fake не существует",
        ));
    }
    let source = bin_dir.join(format!("{fake_name}.bin"));
    let data = std::fs::read(&source).map_err(atomic_io)?;
    let validate = |p: &Path| -> Result<(), atomic::ValidateError> {
        let read = std::fs::read(p).map_err(atomic::ValidateError::Io)?;
        if read == data {
            Ok(())
        } else {
            Err(atomic::ValidateError::Content("mismatch".into()))
        }
    };
    atomic::write_bytes_atomic(&bin_dir.join(target), &data, false, &validate).map(|_| ())
}

fn atomic_io(e: std::io::Error) -> AppError {
    AppError::new("IO_ERROR", "Ошибка доступа к файлам")
        .with_details(serde_json::json!({ "osError": e.to_string() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("control-f-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("lists")).unwrap();
        std::fs::create_dir_all(dir.join("utils")).unwrap();
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        dir
    }

    #[test]
    fn list_write_roundtrip_and_whitelist() {
        let dir = tmpdir("lists");
        list_write(&dir, "generalUser", "example.com\n").unwrap();
        let lists = lists_get(&dir).unwrap();
        let general = lists.iter().find(|l| l.key == "generalUser").unwrap();
        assert_eq!(general.content, "example.com\n");
        assert!(general.exists);

        assert_eq!(
            list_write(&dir, "../evil", "x").unwrap_err().code,
            "INVALID_ARGUMENT"
        );
        assert_eq!(
            list_write(&dir, "unknown", "x").unwrap_err().code,
            "INVALID_ARGUMENT"
        );
    }

    #[test]
    fn game_filter_flag_lifecycle() {
        let dir = tmpdir("gf");
        game_filter_set(&dir, GameFilterMode::All).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("utils").join("game_filter.enabled")).unwrap(),
            "all"
        );
        game_filter_set(&dir, GameFilterMode::Disabled).unwrap();
        assert!(!dir.join("utils").join("game_filter.enabled").exists());
    }

    #[test]
    fn ipset_one_time_backup_never_overwritten() {
        let dir = tmpdir("ipset");
        let list = dir.join("lists").join("ipset-all.txt");
        std::fs::write(&list, "original\nentries\n").unwrap();

        ipset_filter_set(&dir, IpsetMode::None).unwrap();
        assert!(std::fs::read_to_string(&list)
            .unwrap()
            .contains("203.0.113.113"));
        let backup = dir.join("lists").join("ipset-all.txt.backup");
        assert_eq!(
            std::fs::read_to_string(&backup).unwrap(),
            "original\nentries\n"
        );

        std::fs::write(&list, "changed-before-second\n").unwrap();
        ipset_filter_set(&dir, IpsetMode::None).unwrap();
        assert_eq!(
            std::fs::read_to_string(&backup).unwrap(),
            "original\nentries\n"
        );

        ipset_filter_set(&dir, IpsetMode::Loaded).unwrap();
        assert_eq!(
            std::fs::read_to_string(&list).unwrap(),
            "original\nentries\n"
        );

        ipset_filter_set(&dir, IpsetMode::Any).unwrap();
        assert_eq!(std::fs::read_to_string(&list).unwrap(), "");
        assert_eq!(ipset_mode_get(&dir), IpsetMode::Any);
    }

    #[test]
    fn fake_set_matches_and_rejects_unknown() {
        let dir = tmpdir("fakes");
        std::fs::write(dir.join("bin").join("fakeA.bin"), b"payload-a").unwrap();
        std::fs::write(dir.join("bin").join("fakeB.bin"), b"payload-b").unwrap();

        let info = fakes_get(&dir);
        assert_eq!(info.fakes, vec!["fakeA", "fakeB"]);
        assert_eq!(info.current_discord, None);

        fake_set(&dir, "discord", "fakeA").unwrap();
        let info = fakes_get(&dir);
        assert_eq!(info.current_discord, Some("fakeA".to_string()));

        assert_eq!(
            fake_set(&dir, "game", "..\\evil").unwrap_err().code,
            "INVALID_ARGUMENT"
        );
    }
}

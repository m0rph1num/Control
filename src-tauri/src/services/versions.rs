use crate::errors::AppError;
use crate::storage::settings;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledVersion {
    pub folder: String,
    pub version: String,
    pub selected: bool,
    pub has_winws: bool,
}

const VERSION_FOLDER_RE: &str = r"^[vV]?\d+\.\d+\.\d+$";

pub fn version_folder_re() -> &'static regex::Regex {
    use std::sync::OnceLock;
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(VERSION_FOLDER_RE).expect("valid regex"))
}

fn version_number_re() -> &'static regex::Regex {
    use std::sync::OnceLock;
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^\d+\.\d+\.\d+$").expect("valid regex"))
}

pub fn control_dir() -> Result<PathBuf, AppError> {
    let raw = settings::read_settings_raw()?;
    if let Some(dir) = settings::settings_str(&raw, "controlDir") {
        return Ok(PathBuf::from(dir));
    }
    let fallback = settings::app_data_dir()?.join("zapret-versions");
    std::fs::create_dir_all(&fallback).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать папку версий")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(fallback)
}

pub fn list_installed() -> Result<Vec<InstalledVersion>, AppError> {
    let dir = control_dir()?;
    let selected = settings::read_settings_raw()
        .ok()
        .and_then(|s| settings::settings_str(&s, "selectedVersion").map(str::to_string));
    let mut result = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(result);
    };
    for entry in entries.flatten() {
        let folder = entry.file_name().to_string_lossy().into_owned();
        if !version_folder_re().is_match(&folder) {
            continue;
        }
        let path = entry.path();
        let has_winws = path.join("bin").join("winws.exe").is_file();
        result.push(InstalledVersion {
            version: folder.trim_start_matches(['v', 'V']).to_string(),
            selected: selected.as_deref() == Some(folder.as_str()),
            has_winws,
            folder,
        });
    }
    result.sort_by(|a, b| b.version.cmp(&a.version));
    Ok(result)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub notes: Option<String>,
}

fn select_asset(release: &serde_json::Value) -> Option<(String, String)> {
    let assets = release["assets"].as_array()?;
    let mut best: Option<(u8, String, String)> = None;
    for asset in assets {
        let Some(name) = asset["name"].as_str() else {
            continue;
        };
        let Some(url) = asset["browser_download_url"].as_str() else {
            continue;
        };
        let lower = name.to_lowercase();
        let rank = if lower.ends_with(".zip") {
            0
        } else if lower.ends_with(".tar.gz") {
            1
        } else {
            continue;
        };
        if best.as_ref().is_none_or(|(current, _, _)| rank < *current) {
            best = Some((rank, name.to_string(), url.to_string()));
        }
    }
    best.map(|(_, name, url)| (name, url))
}

pub fn fetch_releases_blocking(repo: &str) -> Result<Vec<ReleaseInfo>, AppError> {
    let url = format!("https://api.github.com/repos/{repo}/releases?per_page=20");
    let resp = ureq::get(&url)
        .set("User-Agent", "Control-App")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| {
            AppError::new(
                "NETWORK_ERROR",
                "Не удалось получить список версий с GitHub",
            )
            .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    let json: serde_json::Value = resp.into_json().map_err(|e| {
        AppError::new("NETWORK_ERROR", "Некорректный ответ GitHub")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let mut releases = Vec::new();
    for rel in json.as_array().into_iter().flatten() {
        let tag = rel["tag_name"].as_str().unwrap_or_default().to_string();
        if tag.is_empty() {
            continue;
        }
        let version = tag.trim_start_matches('v').to_string();
        let (asset_name, asset_url) = match select_asset(rel) {
            Some((name, url)) => (Some(name), Some(url)),
            None => (None, None),
        };
        releases.push(ReleaseInfo {
            version,
            asset_name,
            asset_url,
            notes: rel["body"].as_str().map(str::to_string),
        });
    }
    if releases.is_empty() {
        return Err(AppError::new(
            "NO_RELEASES",
            "GitHub не вернул доступных версий",
        ));
    }
    Ok(releases)
}

pub fn temp_download_path(version: &str, asset_name: &str) -> Result<PathBuf, AppError> {
    let dir = settings::app_data_dir()?.join("temp-downloads");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать папку загрузок")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let ext = archive_ext(asset_name)?;
    Ok(dir.join(format!("zapret-{version}{ext}")))
}

fn archive_ext(asset_name: &str) -> Result<String, AppError> {
    let lower = asset_name.to_lowercase();
    if lower.ends_with(".tar.gz") {
        Ok(".tar.gz".into())
    } else if lower.ends_with(".zip") {
        Ok(".zip".into())
    } else {
        Err(AppError::new(
            "UNSUPPORTED_ARCHIVE",
            "У этого релиза нет архива .zip или .tar.gz",
        )
        .with_details(serde_json::json!({ "asset": asset_name })))
    }
}

enum ArchiveKind {
    Zip,
    TarGz,
}

fn detect_archive(archive: &Path) -> Result<ArchiveKind, AppError> {
    use std::io::Read;
    let mut head = [0u8; 4];
    let read = std::fs::File::open(archive)
        .and_then(|mut file| file.read(&mut head))
        .unwrap_or(0);
    if read >= 4 && head[..4] == [0x50, 0x4b, 0x03, 0x04] {
        return Ok(ArchiveKind::Zip);
    }
    if read >= 2 && head[..2] == [0x1f, 0x8b] {
        return Ok(ArchiveKind::TarGz);
    }
    if read >= 4 && &head[..4] == b"Rar!" {
        return Err(AppError::new(
            "UNSUPPORTED_ARCHIVE",
            "GitHub отдал RAR-архив, а он не поддерживается. Обновите список версий",
        ));
    }
    let name = archive.to_string_lossy().to_lowercase();
    if name.ends_with(".zip") {
        Ok(ArchiveKind::Zip)
    } else if name.ends_with(".tar.gz") {
        Ok(ArchiveKind::TarGz)
    } else {
        Err(AppError::new(
            "UNSUPPORTED_ARCHIVE",
            "Файл не похож на .zip или .tar.gz. Скачайте версию заново",
        ))
    }
}

pub fn download_blocking(
    url: &str,
    dest: &Path,
    cancel: &CancellationToken,
    on_progress: &dyn Fn(u64, u64),
) -> Result<(), AppError> {
    if !url.starts_with("https://") {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Разрешены только https-ссылки",
        ));
    }
    if let Ok(meta) = std::fs::metadata(dest) {
        if meta.len() > 0 && detect_archive(dest).is_ok() {
            on_progress(meta.len(), meta.len());
            return Ok(());
        }
    }
    let resp = ureq::get(url)
        .set("User-Agent", "Control-App")
        .timeout(std::time::Duration::from_secs(600))
        .call()
        .map_err(|e| {
            AppError::new("NETWORK_ERROR", "Ошибка скачивания")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    let total = resp
        .header("Content-Length")
        .and_then(|l| l.parse::<u64>().ok())
        .unwrap_or(0);

    let part = dest.with_extension(format!("part-{}", uuid::Uuid::new_v4().simple()));
    use std::io::{Read, Write};
    let mut reader = resp.into_reader();
    let mut file = std::io::BufWriter::new(std::fs::File::create(&part).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать временный файл")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?);
    let mut downloaded: u64 = 0;
    let mut buf = [0u8; 65536];
    loop {
        if cancel.is_cancelled() {
            drop(file);
            let _ = std::fs::remove_file(&part);
            return Err(AppError::new("CANCELLED", "Загрузка отменена"));
        }
        let n = reader.read(&mut buf).map_err(|e| {
            AppError::new("NETWORK_ERROR", "Соединение прервано при загрузке")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| {
            AppError::new(
                "IO_ERROR",
                "Ошибка записи при загрузке (проверьте место на диске)",
            )
            .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
        downloaded += n as u64;
        if total > 0 {
            on_progress(downloaded, total);
        }
    }
    file.flush().map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось сохранить загрузку")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    drop(file);
    if total > 0 && downloaded != total {
        let _ = std::fs::remove_file(&part);
        return Err(AppError::new(
            "DOWNLOAD_INCOMPLETE",
            format!("Загружено {downloaded} из {total} байт"),
        ));
    }
    std::fs::rename(&part, dest).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        AppError::new("IO_ERROR", "Не удалось сохранить загруженный файл")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(())
}

pub fn install_blocking(version: &str, temp_archive: &Path) -> Result<InstalledVersion, AppError> {
    if !version_number_re().is_match(version) {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Некорректный номер версии",
        ));
    }
    if !temp_archive.is_file() {
        return Err(AppError::new(
            "ARCHIVE_MISSING",
            "Архив не найден. Скачайте версию заново",
        ));
    }
    let size = std::fs::metadata(temp_archive)
        .map(|m| m.len())
        .unwrap_or(0);
    if size == 0 {
        let _ = std::fs::remove_file(temp_archive);
        return Err(AppError::new("ARCHIVE_EMPTY", "Скачанный файл пуст"));
    }

    let root = control_dir()?;
    let ver_name = format!("v{version}");
    let ver_dir = root.join(&ver_name);
    let staging = root.join(format!(
        "{ver_name}.staging-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&staging).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать staging-папку")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;

    let result = extract_and_finalize(version, temp_archive, &root, &ver_dir, &staging);
    if let Err(err) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(err);
    }

    Ok(InstalledVersion {
        folder: ver_name.clone(),
        version: version.to_string(),
        selected: true,
        has_winws: true,
    })
}

fn extract_and_finalize(
    version: &str,
    archive: &Path,
    root: &Path,
    ver_dir: &Path,
    staging: &Path,
) -> Result<(), AppError> {
    let extracted = match detect_archive(archive)? {
        ArchiveKind::Zip => extract_zip_via_powershell(archive, staging)?,
        ArchiveKind::TarGz => extract_tar_gz(archive, staging)?,
    };
    if !extracted {
        return Err(AppError::new("EXTRACT_EMPTY", "Архив пуст или повреждён"));
    }

    flatten_single_root(staging)?;

    preserve_user_customizations(&root.join(format!("v{version}")), staging);

    if !staging.join("bin").join("winws.exe").is_file() {
        return Err(AppError::new(
            "INVALID_ARCHIVE",
            "В архиве нет bin/winws.exe — это не сборка Zapret",
        ));
    }

    let old_dir = root.join(format!("v{version}.old-{}", uuid::Uuid::new_v4().simple()));
    if ver_dir.exists() {
        std::fs::rename(ver_dir, &old_dir).map_err(|e| {
            AppError::new("IO_ERROR", "Не удалось отвести прежнюю версию")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    }
    if let Err(e) = std::fs::rename(staging, ver_dir) {
        if old_dir.exists() {
            let _ = std::fs::rename(&old_dir, ver_dir);
        }
        return Err(
            AppError::new("IO_ERROR", "Не удалось установить новую версию")
                .with_details(serde_json::json!({ "error": e.to_string() })),
        );
    }

    if old_dir.exists() {
        let _ = std::fs::remove_dir_all(&old_dir);
    }

    let mut content = settings::read_settings_recovering()?.content;
    if content.is_null() {
        content = serde_json::json!({});
    }
    content["selectedVersion"] = serde_json::json!(format!("v{version}"));
    let path = settings::settings_path()?;
    atomic_path_write(&path, &content)?;
    Ok(())
}

fn atomic_path_write(path: &Path, value: &serde_json::Value) -> Result<(), AppError> {
    atomic_write_settings(path, value)
}

fn extract_zip_via_powershell(archive: &Path, staging: &Path) -> Result<bool, AppError> {
    let script = format!(
        "try {{ Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force; exit 0 }} catch {{ Write-Error $_.Exception.Message; exit 1 }}",
        ps_quote(&archive.to_string_lossy()),
        ps_quote(&staging.to_string_lossy()),
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &script]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = run_blocking_cmd_sync(&mut cmd)?;
    Ok(out && file_count(staging) > 0)
}

fn extract_tar_gz(archive: &Path, staging: &Path) -> Result<bool, AppError> {
    let mut cmd = std::process::Command::new("tar");
    cmd.args([
        "-xzf",
        &archive.to_string_lossy(),
        "-C",
        &staging.to_string_lossy(),
    ]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let ok = run_blocking_cmd_sync(&mut cmd)?;
    Ok(ok && file_count(staging) > 0)
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(not(windows))]
const CREATE_NO_WINDOW: u32 = 0;

fn run_blocking_cmd_sync(cmd: &mut std::process::Command) -> Result<bool, AppError> {
    use std::process::Stdio;
    let output = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            AppError::new("EXTRACT_SPAWN_FAILED", "Не удалось запустить распаковку")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    if !output.status.success() {
        return Err(AppError::new(
            "EXTRACT_FAILED",
            "Не удалось распаковать архив",
        )
        .with_details(serde_json::json!({
            "stderr": String::from_utf8_lossy(&output.stderr).chars().take(300).collect::<String>()
        })));
    }
    Ok(true)
}

fn file_count(dir: &Path) -> usize {
    std::fs::read_dir(dir).map(|d| d.count()).unwrap_or(0)
}

fn flatten_single_root(staging: &Path) -> Result<(), AppError> {
    let entries: Vec<PathBuf> = std::fs::read_dir(staging)
        .map_err(|e| io_err("Не удалось прочитать staging-папку", e))?
        .flatten()
        .map(|e| e.path())
        .collect();
    if entries.len() != 1 || !entries[0].is_dir() {
        return Ok(());
    }
    let sub = &entries[0];
    for item in std::fs::read_dir(sub)
        .map_err(|e| io_err("Не удалось прочитать содержимое архива", e))?
        .flatten()
    {
        let dst = staging.join(item.file_name());
        std::fs::rename(item.path(), &dst).map_err(|e| {
            AppError::new("IO_ERROR", "Не удалось развернуть содержимое архива")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    }
    std::fs::remove_dir(sub).map_err(|e| io_err("Не удалось удалить корневую папку архива", e))?;
    Ok(())
}

fn io_err(message: &str, e: std::io::Error) -> AppError {
    AppError::new("IO_ERROR", message).with_details(serde_json::json!({ "error": e.to_string() }))
}

fn preserve_user_customizations(old_dir: &Path, staging: &Path) {
    let old_lists = old_dir.join("lists");
    if !old_lists.is_dir() {
        return;
    }
    let new_lists = staging.join("lists");
    let _ = std::fs::create_dir_all(&new_lists);
    for (_, file, _) in crate::services::filters::LIST_FILES {
        let src = old_lists.join(file);
        if src.is_file() {
            if let Ok(content) = std::fs::read(&src) {
                let dst = new_lists.join(file);
                let validate = |p: &Path| -> Result<(), crate::storage::atomic::ValidateError> {
                    let read =
                        std::fs::read(p).map_err(crate::storage::atomic::ValidateError::Io)?;
                    if read == content {
                        Ok(())
                    } else {
                        Err(crate::storage::atomic::ValidateError::Content(
                            "mismatch".into(),
                        ))
                    }
                };
                let _ =
                    crate::storage::atomic::write_bytes_atomic(&dst, &content, false, &validate);
            }
        }
    }
    let flag = old_dir.join("utils").join("game_filter.enabled");
    if flag.is_file() {
        if let Ok(mode) = std::fs::read_to_string(&flag) {
            let utils_dir = staging.join("utils");
            let _ = std::fs::create_dir_all(&utils_dir);
            let dst = utils_dir.join("game_filter.enabled");
            let bytes = mode.into_bytes();
            let validate = |p: &Path| -> Result<(), crate::storage::atomic::ValidateError> {
                let read = std::fs::read(p).map_err(crate::storage::atomic::ValidateError::Io)?;
                if read == bytes {
                    Ok(())
                } else {
                    Err(crate::storage::atomic::ValidateError::Content(
                        "mismatch".into(),
                    ))
                }
            };
            let _ = crate::storage::atomic::write_bytes_atomic(&dst, &bytes, false, &validate);
        }
    }
}

pub fn atomic_write_settings(path: &Path, value: &serde_json::Value) -> Result<(), AppError> {
    let validate = |p: &Path| -> Result<(), crate::storage::atomic::ValidateError> {
        std::fs::read_to_string(p)
            .map_err(crate::storage::atomic::ValidateError::Io)
            .and_then(|t| {
                serde_json::from_str::<serde_json::Value>(&t)
                    .map(|_| ())
                    .map_err(|e| crate::storage::atomic::ValidateError::Content(e.to_string()))
            })
    };
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| {
        AppError::new("SERIALIZATION_FAILED", "Ошибка сериализации настроек")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    crate::storage::atomic::write_bytes_atomic(path, &bytes, true, &validate).map(|_| ())
}

pub fn delete_version(folder: &str) -> Result<(), AppError> {
    if !version_folder_re().is_match(folder) {
        return Err(AppError::new("INVALID_ARGUMENT", "Некорректное имя версии"));
    }
    let dir = control_dir()?.join(folder);
    if !dir.is_dir() {
        return Err(AppError::new("NOT_FOUND", "Папка версии не найдена"));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось удалить папку версии")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let snapshot = settings::read_settings_recovering()?;
    if snapshot.content["selectedVersion"].as_str() == Some(folder) {
        let mut content = snapshot.content.clone();
        content["selectedVersion"] = serde_json::json!("");
        let path = settings::settings_path()?;
        atomic_path_write(&path, &content)?;
    }
    Ok(())
}

fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("control-v-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn version_folder_validation() {
        assert!(regex::Regex::new(VERSION_FOLDER_RE)
            .unwrap()
            .is_match("v1.10.0"));
        assert!(regex::Regex::new(VERSION_FOLDER_RE)
            .unwrap()
            .is_match("1.2.3"));
        assert!(!regex::Regex::new(VERSION_FOLDER_RE)
            .unwrap()
            .is_match("..\\evil"));
        assert!(!regex::Regex::new(VERSION_FOLDER_RE)
            .unwrap()
            .is_match("v1.10.0.extra"));
    }

    #[test]
    fn archive_ext_detection() {
        assert_eq!(archive_ext("zapret-1.10.0.tar.gz").unwrap(), ".tar.gz");
        assert_eq!(archive_ext("zapret-1.10.0.zip").unwrap(), ".zip");
        assert_eq!(
            archive_ext("zapret-1.10.0.rar").unwrap_err().code,
            "UNSUPPORTED_ARCHIVE"
        );
    }

    #[test]
    fn selects_zip_asset_over_rar_and_tar_gz() {
        let release = serde_json::json!({
            "assets": [
                { "name": "zapret.rar", "browser_download_url": "https://x/rar" },
                { "name": "zapret.tar.gz", "browser_download_url": "https://x/tgz" },
                { "name": "zapret.zip", "browser_download_url": "https://x/zip" }
            ]
        });
        let (name, url) = select_asset(&release).unwrap();
        assert_eq!(name, "zapret.zip");
        assert_eq!(url, "https://x/zip");
    }

    #[test]
    fn release_without_supported_asset_has_no_url() {
        let release = serde_json::json!({
            "assets": [{ "name": "zapret.rar", "browser_download_url": "https://x/rar" }]
        });
        assert!(select_asset(&release).is_none());
    }

    #[test]
    fn install_rejects_bad_version_and_missing_archive() {
        let dir = tmpdir("bad");
        assert_eq!(
            install_blocking("..\\evil", &dir.join("a.zip"))
                .unwrap_err()
                .code,
            "INVALID_ARGUMENT"
        );
        assert_eq!(
            install_blocking("1.2.3", &dir.join("missing.zip"))
                .unwrap_err()
                .code,
            "ARCHIVE_MISSING"
        );
    }

    #[test]
    fn install_empty_archive_is_rejected_without_touching_old() {
        let dir = tmpdir("empty");
        let archive = dir.join("a.zip");
        std::fs::write(&archive, b"").unwrap();

        let err = install_blocking("9.9.9", &archive).unwrap_err();
        assert_eq!(err.code, "ARCHIVE_EMPTY");
    }
}

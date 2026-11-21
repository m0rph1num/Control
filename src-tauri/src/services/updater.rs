use crate::errors::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const REPO: &str = "m0rph1num/Control";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub version: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub size: Option<u64>,
    pub page_url: String,
}

fn parse_version(raw: &str) -> Vec<u64> {
    raw.trim()
        .trim_start_matches(['v', 'V'])
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    let next = parse_version(candidate);
    let now = parse_version(current);
    for index in 0..next.len().max(now.len()) {
        let a = next.get(index).copied().unwrap_or(0);
        let b = now.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

fn pick_asset(assets: &[serde_json::Value]) -> Option<&serde_json::Value> {
    let is_exe = |asset: &serde_json::Value| {
        asset["name"]
            .as_str()
            .is_some_and(|name| name.to_lowercase().ends_with(".exe"))
    };
    let preferred = assets.iter().find(|asset| {
        if !is_exe(asset) {
            return false;
        }
        let name = asset["name"].as_str().unwrap_or("").to_lowercase();
        name.contains("setup") || name.contains("install")
    });
    preferred.or_else(|| assets.iter().find(|asset| is_exe(asset)))
}

pub fn check_blocking() -> Result<UpdateInfo, AppError> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let response = ureq::get(&url)
        .set("User-Agent", "Control-App")
        .set("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| {
            let missing = matches!(&e, ureq::Error::Status(404, _));
            AppError::new(
                if missing {
                    "NO_RELEASES"
                } else {
                    "NETWORK_ERROR"
                },
                if missing {
                    "Релизы Control ещё не опубликованы"
                } else {
                    "Не удалось проверить обновления"
                },
            )
            .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    let json: serde_json::Value = response.into_json().map_err(|e| {
        AppError::new("NETWORK_ERROR", "Некорректный ответ GitHub")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let tag = json["tag_name"]
        .as_str()
        .ok_or_else(|| AppError::new("NO_RELEASES", "GitHub не вернул информацию о релизе"))?;
    let version = tag.trim_start_matches(['v', 'V']).to_string();
    let assets = json["assets"].as_array().cloned().unwrap_or_default();
    let asset = pick_asset(&assets);
    let asset_name = asset.and_then(|a| a["name"].as_str().map(str::to_string));
    let asset_url = asset.and_then(|a| a["browser_download_url"].as_str().map(str::to_string));
    let size = asset.and_then(|a| a["size"].as_u64());

    Ok(UpdateInfo {
        available: is_newer(&version, &current_version),
        current_version,
        version,
        notes: json["body"].as_str().map(str::to_string),
        published_at: json["published_at"].as_str().map(str::to_string),
        asset_name,
        asset_url,
        size,
        page_url: format!("https://github.com/{REPO}/releases/latest"),
    })
}

fn safe_version(version: &str) -> String {
    let cleaned: String = version
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    if cleaned.is_empty() {
        "update".to_string()
    } else {
        cleaned
    }
}

pub fn installer_path(version: &str) -> Result<PathBuf, AppError> {
    let dir = crate::storage::settings::app_data_dir()?.join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать папку обновлений")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(dir.join(format!("Control-{}-setup.exe", safe_version(version))))
}

pub fn download_blocking(
    url: &str,
    version: &str,
    cancel: &CancellationToken,
    on_progress: &dyn Fn(u64, u64),
) -> Result<PathBuf, AppError> {
    let dest = installer_path(version)?;
    crate::services::versions::download_blocking(url, &dest, cancel, on_progress)?;
    Ok(dest)
}

pub fn launch_installer(installer: &Path) -> Result<(), AppError> {
    if !installer.is_file() {
        return Err(AppError::new(
            "INSTALLER_MISSING",
            "Файл обновления не найден. Скачайте обновление заново",
        ));
    }
    if !installer.to_string_lossy().to_lowercase().ends_with(".exe") {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Некорректный файл обновления",
        ));
    }
    let exe = std::env::current_exe().map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось определить путь к Control")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let script = crate::storage::settings::app_data_dir()?.join("apply-update.cmd");
    let content = format!(
        "@echo off\r\nchcp 65001 >nul\r\ntimeout /t 2 /nobreak >nul\r\nset \"CTL_SETUP={}\"\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command \"try {{ Start-Process -FilePath $env:CTL_SETUP -ArgumentList '/S' -Verb RunAs -Wait }} catch {{ exit 1 }}\"\r\nstart \"\" \"{}\"\r\ndel \"%~f0\"\r\n",
        installer.display(),
        exe.display()
    );
    std::fs::write(&script, content).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось подготовить установку обновления")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;

    use std::os::windows::process::CommandExt;
    std::process::Command::new("cmd")
        .arg("/C")
        .arg(&script)
        .creation_flags(0x0000_0008 | 0x0800_0000)
        .spawn()
        .map_err(|e| {
            AppError::new("UPDATE_FAILED", "Не удалось запустить установку обновления")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare_orders_numeric_parts() {
        assert!(is_newer("2.1.0", "2.0.0"));
        assert!(is_newer("2.0.10", "2.0.9"));
        assert!(is_newer("v2.0.1", "2.0.0"));
        assert!(!is_newer("2.0.0", "2.0.0"));
        assert!(!is_newer("1.9.9", "2.0.0"));
    }

    #[test]
    fn asset_prefers_setup_executable() {
        let assets = vec![
            serde_json::json!({ "name": "Control_2.0.0_x64.msi", "browser_download_url": "https://example.com/a.msi" }),
            serde_json::json!({ "name": "Control_2.0.0_x64-setup.exe", "browser_download_url": "https://example.com/b.exe" }),
            serde_json::json!({ "name": "Control_2.0.0_x64.nsis.zip", "browser_download_url": "https://example.com/c.zip" }),
        ];
        let picked = pick_asset(&assets).expect("asset");
        assert_eq!(picked["name"], "Control_2.0.0_x64-setup.exe");
    }
}

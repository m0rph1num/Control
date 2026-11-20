use crate::errors::AppError;

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "Control";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn run_reg(args: &[&str]) -> Result<std::process::Output, AppError> {
    let mut cmd = std::process::Command::new("reg");
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output().map_err(|e| {
        AppError::new("REG_UNAVAILABLE", "Не удалось обратиться к реестру Windows")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })
}

pub fn current_command() -> Option<String> {
    let out = run_reg(&["query", RUN_KEY, "/v", VALUE_NAME]).ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);

    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with(VALUE_NAME) {
            continue;
        }
        let mut parts = trimmed.splitn(3, char::is_whitespace);
        let _name = parts.next();
        let _kind = parts.next();
        let value = parts.next()?.trim();
        if value.is_empty() {
            return None;
        }
        return Some(value.to_string());
    }
    None
}

pub fn is_enabled() -> bool {
    current_command().is_some()
}

fn executable() -> Option<std::path::PathBuf> {
    std::env::current_exe().ok()
}

pub fn matches_current() -> bool {
    let Some(command) = current_command() else {
        return false;
    };
    let Some(exe) = executable() else {
        return false;
    };
    let needle = exe.to_string_lossy().to_lowercase();
    command.to_lowercase().contains(&needle)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartInfo {
    pub enabled: bool,
    pub current: bool,
    pub command: Option<String>,
}

pub fn info() -> AutostartInfo {
    let command = current_command();
    AutostartInfo {
        enabled: command.is_some(),
        current: matches_current(),
        command,
    }
}

pub fn set_enabled(enabled: bool) -> Result<(), AppError> {
    if enabled {
        let exe = executable()
            .ok_or_else(|| AppError::new("ENV_MISSING", "Не удалось определить путь к Control"))?;
        let command = format!("\"{}\" --minimized", exe.display());
        let out = run_reg(&[
            "add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", &command, "/f",
        ])?;
        if !out.status.success() {
            return Err(AppError::new(
                "AUTOSTART_FAILED",
                "Не удалось включить автозапуск Control",
            )
            .with_details(serde_json::json!({
                "stderr": String::from_utf8_lossy(&out.stderr).to_string()
            })));
        }
        Ok(())
    } else {
        let out = run_reg(&["delete", RUN_KEY, "/v", VALUE_NAME, "/f"])?;

        if !out.status.success() && current_command().is_some() {
            return Err(AppError::new(
                "AUTOSTART_FAILED",
                "Не удалось отключить автозапуск Control",
            ));
        }
        Ok(())
    }
}

pub fn launched_minimized() -> bool {
    std::env::args().any(|a| a.eq_ignore_ascii_case("--minimized"))
}

use crate::errors::AppError;

const TASK_NAME: &str = "Control";
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const LEGACY_VALUE_NAME: &str = "Control";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn run_tool(program: &str, args: &[&str]) -> Result<std::process::Output, AppError> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.output().map_err(|e| {
        AppError::new(
            "AUTOSTART_UNAVAILABLE",
            "Не удалось обратиться к автозапуску Windows",
        )
        .with_details(serde_json::json!({ "error": e.to_string(), "tool": program }))
    })
}

fn run_reg(args: &[&str]) -> Result<std::process::Output, AppError> {
    run_tool("reg", args)
}

fn xml_value(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(unescape(&xml[start..end]))
}

fn unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn task_command() -> Option<String> {
    let out = run_tool("schtasks", &["/Query", "/TN", TASK_NAME, "/XML"]).ok()?;
    if !out.status.success() {
        return None;
    }
    let xml = String::from_utf8_lossy(&out.stdout);
    let command = xml_value(&xml, "Command")?;
    let arguments = xml_value(&xml, "Arguments").unwrap_or_default();
    let arguments = arguments.trim();
    if arguments.is_empty() {
        Some(format!("\"{command}\""))
    } else {
        Some(format!("\"{command}\" {arguments}"))
    }
}

fn legacy_command() -> Option<String> {
    let out = run_reg(&["query", RUN_KEY, "/v", LEGACY_VALUE_NAME]).ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with(LEGACY_VALUE_NAME) {
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

pub fn current_command() -> Option<String> {
    task_command().or_else(legacy_command)
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

fn remove_legacy() {
    let _ = run_reg(&["delete", RUN_KEY, "/v", LEGACY_VALUE_NAME, "/f"]);
}

fn create_task(exe: &str) -> Result<(), AppError> {
    let target = format!("\"{exe}\" --minimized");
    let out = run_tool(
        "schtasks",
        &[
            "/Create", "/TN", TASK_NAME, "/SC", "ONLOGON", "/RL", "HIGHEST", "/TR", &target, "/F",
        ],
    )?;
    if !out.status.success() {
        return Err(
            AppError::new("AUTOSTART_FAILED", "Не удалось включить автозапуск Control")
                .with_details(serde_json::json!({
                    "stderr": String::from_utf8_lossy(&out.stderr).to_string(),
                    "stdout": String::from_utf8_lossy(&out.stdout).to_string()
                })),
        );
    }
    if task_command().is_none() {
        return Err(AppError::new(
            "AUTOSTART_FAILED",
            "Windows не подтвердил создание задачи автозапуска",
        ));
    }
    Ok(())
}

fn delete_task() -> Result<(), AppError> {
    let out = run_tool("schtasks", &["/Delete", "/TN", TASK_NAME, "/F"])?;
    if out.status.success() || task_command().is_none() {
        return Ok(());
    }
    Err(AppError::new(
        "AUTOSTART_FAILED",
        "Не удалось отключить автозапуск Control",
    )
    .with_details(serde_json::json!({
        "stderr": String::from_utf8_lossy(&out.stderr).to_string()
    })))
}

pub fn set_enabled(enabled: bool) -> Result<(), AppError> {
    if enabled {
        let exe = executable()
            .ok_or_else(|| AppError::new("ENV_MISSING", "Не удалось определить путь к Control"))?;
        create_task(&exe.to_string_lossy())?;
        remove_legacy();
        Ok(())
    } else {
        delete_task()?;
        remove_legacy();
        Ok(())
    }
}

pub fn migrate_legacy() {
    if legacy_command().is_none() {
        return;
    }
    if set_enabled(true).is_ok() {
        tracing::info!("автозапуск Control переведён на задачу планировщика");
    } else {
        tracing::warn!("не удалось перенести автозапуск Control в планировщик задач");
    }
}

pub fn launched_minimized() -> bool {
    std::env::args().any(|a| a.eq_ignore_ascii_case("--minimized"))
}

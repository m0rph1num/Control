use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const PLAN_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ElevationStep {
    pub action: String,
    #[serde(flatten)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ElevationPlan {
    pub plan_version: u32,
    pub description: String,
    pub steps: Vec<ElevationStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StepReport {
    pub action: String,
    pub ok: bool,
    pub exit_code: Option<i32>,

    pub output_tail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ElevationReport {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub steps: Vec<StepReport>,
}

pub fn pending_dir() -> Result<PathBuf, AppError> {
    let dir = crate::storage::settings::app_data_dir()?.join("pending-elevation");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать папку обмена elevation")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(dir)
}

pub fn helper_path() -> Result<PathBuf, AppError> {
    let exe = std::env::current_exe().map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось определить путь приложения")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let dir = exe
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_default();
    let mut candidates = vec![dir.join("control-elevate.exe")];

    let sidecar = format!("control-elevate-{}.exe", env!("TARGET"));
    candidates.push(dir.join(sidecar));
    for p in &candidates {
        let usable = p
            .metadata()
            .map(|m| m.is_file() && m.len() > 0)
            .unwrap_or(false);
        if usable {
            return Ok(p.clone());
        }
    }
    Err(AppError::new(
        "HELPER_MISSING",
        "Не найден компонент повышения привилегий (control-elevate.exe). Переустановите приложение",
    )
    .with_details(serde_json::json!({
        "searched": candidates.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>()
    })))
}

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows::Win32::UI::Shell::IsUserAnAdmin;
    unsafe { IsUserAnAdmin().as_bool() }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

struct HelperRun {
    exit_code: Option<i32>,
    stderr: String,
}

pub fn run_elevated(
    plan: &ElevationPlan,
    timeout: std::time::Duration,
) -> Result<ElevationReport, AppError> {
    let dir = pending_dir()?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let plan_path = dir.join(format!("{token}.plan.json"));
    let report_path = dir.join(format!("{token}.report.json"));

    let plan_json = serde_json::to_vec_pretty(plan).map_err(|e| {
        AppError::new("SERIALIZATION_FAILED", "Ошибка формирования плана")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    std::fs::write(&plan_path, &plan_json).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось записать план")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;

    let launch = launch_helper(&plan_path, &report_path, timeout);
    let report = read_report(&report_path);

    let _ = std::fs::remove_file(&plan_path);
    let _ = std::fs::remove_file(&report_path);

    match (launch, report) {
        (_, Some(report)) => Ok(report),
        (Err(AppError { code, .. }), None) if code == "UAC_CANCELLED" => Err(AppError::new(
            "UAC_CANCELLED",
            "Запрос повышения привилегий отклонён. Операция не выполнена",
        )),
        (Err(e), None) => Err(e),
        (Ok(run), None) => {
            let helper = helper_path()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| "control-elevate.exe".into());
            let mut error = AppError::new(
                "ELEVATION_REPORT_MISSING",
                if is_elevated() {
                    "Хелпер повышения не вернул отчёт. Запустите Control ещё раз или переустановите приложение"
                } else {
                    "Хелпер повышения не вернул отчёт. Подтвердите запрос UAC и повторите"
                },
            );
            error = error.with_details(serde_json::json!({
                "helper": helper,
                "exitCode": run.exit_code,
                "stderr": run.stderr.chars().take(400).collect::<String>(),
                "elevated": is_elevated(),
            }));
            Err(error)
        }
    }
}

fn read_report(path: &Path) -> Option<ElevationReport> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(3000);
    loop {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(report) = serde_json::from_slice::<ElevationReport>(&bytes) {
                return Some(report);
            }
        }
        if std::time::Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
    }
}

fn launch_helper(
    plan: &Path,
    report: &Path,
    timeout: std::time::Duration,
) -> Result<HelperRun, AppError> {
    if !plan.is_absolute() || !report.is_absolute() {
        return Err(AppError::new(
            "INTERNAL",
            "Пути plan/report должны быть абсолютными",
        ));
    }
    let helper = helper_path()?;
    if is_elevated() {
        return run_helper_direct(&helper, plan, report, timeout);
    }
    run_helper_via_uac(&helper, plan, report, timeout)
}

fn wait_with_timeout(
    child: &mut std::process::Child,
    timeout: std::time::Duration,
) -> Result<Option<std::process::ExitStatus>, AppError> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(Some(status)),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(None);
                }
                std::thread::sleep(std::time::Duration::from_millis(120));
            }
            Err(e) => {
                return Err(AppError::new(
                    "ELEVATION_LAUNCH_FAILED",
                    "Ошибка ожидания хелпера повышения",
                )
                .with_details(serde_json::json!({ "error": e.to_string() })));
            }
        }
    }
}

fn collect_stderr(child: &mut std::process::Child) -> String {
    use std::io::Read;
    let mut text = String::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = stderr.read_to_string(&mut text);
    }
    text
}

fn run_helper_direct(
    helper: &Path,
    plan: &Path,
    report: &Path,
    timeout: std::time::Duration,
) -> Result<HelperRun, AppError> {
    let mut cmd = std::process::Command::new(helper);
    cmd.arg(plan).arg(report);
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| {
        AppError::new(
            "ELEVATION_LAUNCH_FAILED",
            "Не удалось запустить хелпер повышения привилегий",
        )
        .with_details(serde_json::json!({
            "error": e.to_string(),
            "helper": helper.to_string_lossy(),
        }))
    })?;
    let status = wait_with_timeout(&mut child, timeout)?;
    let stderr = collect_stderr(&mut child);
    match status {
        Some(status) => Ok(HelperRun {
            exit_code: status.code(),
            stderr,
        }),
        None => Err(AppError::new(
            "ELEVATION_TIMEOUT",
            "Операция с повышением привилегий не завершилась за отведённое время",
        )),
    }
}

fn run_helper_via_uac(
    helper: &Path,
    plan: &Path,
    report: &Path,
    timeout: std::time::Duration,
) -> Result<HelperRun, AppError> {
    let arguments = format!(
        "\"{}\" \"{}\"",
        plan.to_string_lossy(),
        report.to_string_lossy()
    );
    let script = format!(
        "try {{ $p = Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -Wait -PassThru; exit $p.ExitCode }} catch {{ if ($_.Exception.HResult -eq -2147023673 -or $_.Exception.Message -match 'cancel|отмен') {{ exit 1223 }} else {{ Write-Error $_.Exception.Message; exit 1 }} }}",
        ps_quote(&helper.to_string_lossy()),
        ps_quote(&arguments),
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd.spawn().map_err(|e| {
        AppError::new(
            "ELEVATION_LAUNCH_FAILED",
            "Не удалось запустить запрос повышения привилегий",
        )
        .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let status = wait_with_timeout(&mut child, timeout)?;
    let stderr = collect_stderr(&mut child);
    match status {
        Some(status) => {
            if status.code() == Some(1223) {
                Err(AppError::new("UAC_CANCELLED", ""))
            } else {
                Ok(HelperRun {
                    exit_code: status.code(),
                    stderr,
                })
            }
        }
        None => Err(AppError::new(
            "ELEVATION_TIMEOUT",
            "Операция с повышением привилегий не завершилась за отведённое время",
        )),
    }
}

fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_serializes_steps_with_params() {
        let plan = ElevationPlan {
            plan_version: PLAN_VERSION,
            description: "Создание службы zapret".into(),
            steps: vec![ElevationStep {
                action: "service_create".into(),
                params: serde_json::json!({ "name": "zapret" }),
            }],
        };
        let json = serde_json::to_value(&plan).unwrap();
        assert_eq!(json["steps"][0]["action"], "service_create");
        assert_eq!(json["steps"][0]["name"], "zapret");
    }

    #[test]
    fn report_deserializes() {
        let report: ElevationReport = serde_json::from_str(
            r#"{"ok":false,"error":"NOT_ADMIN","steps":[{"action":"service_stop","ok":false,"exit_code":5,"output_tail":"Access denied"}]}"#,
        )
        .unwrap();
        assert!(!report.ok);
        assert_eq!(report.steps[0].exit_code, Some(5));
    }
}

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
    for p in candidates {
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(AppError::new(
        "HELPER_MISSING",
        "Не найден компонент повышения привилегий (control-elevate.exe). Переустановите приложение",
    ))
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

    let result = launch_helper(&plan_path, &report_path, timeout);

    let report = std::fs::read(&report_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ElevationReport>(&bytes).ok());

    let _ = std::fs::remove_file(&plan_path);
    let _ = std::fs::remove_file(&report_path);

    match (result, report) {
        (_, Some(report)) => Ok(report),
        (Ok(_), None) => Err(AppError::new(
            "ELEVATION_REPORT_MISSING",
            "Хелпер повышения не вернул отчёт о выполнении",
        )),
        (Err(AppError { code, .. }), None) if code == "UAC_CANCELLED" => Err(AppError::new(
            "UAC_CANCELLED",
            "Запрос повышения привилегий отклонён. Операция не выполнена",
        )),
        (Err(e), None) => Err(e),
    }
}

fn launch_helper(plan: &Path, report: &Path, timeout: std::time::Duration) -> Result<(), AppError> {
    if !plan.is_absolute() || !report.is_absolute() {
        return Err(AppError::new(
            "INTERNAL",
            "Пути plan/report должны быть абсолютными",
        ));
    }
    let helper = helper_path()?;
    let script = format!(
        "try {{ $p = Start-Process -FilePath '{}' -ArgumentList '\"{}\" \"{}\"' -Verb RunAs -Wait -PassThru; exit $p.ExitCode }} catch {{ if ($_.Exception.Message -match 'cancel') {{ exit 1223 }} else {{ Write-Error $_.Exception.Message; exit 1 }} }}",
        ps_quote(&helper.to_string_lossy()),
        ps_quote(&plan.to_string_lossy()),
        ps_quote(&report.to_string_lossy()),
    );

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            AppError::new(
                "ELEVATION_LAUNCH_FAILED",
                "Не удалось запустить запрос повышения привилегий",
            )
            .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    let mut child = child;
    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    break None;
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Err(e) => {
                return Err(AppError::new(
                    "ELEVATION_LAUNCH_FAILED",
                    "Ошибка ожидания хелпера повышения",
                )
                .with_details(serde_json::json!({ "error": e.to_string() })));
            }
        }
    };
    match status {
        Some(status) => {
            if status.code() == Some(1223) {
                Err(AppError::new("UAC_CANCELLED", ""))
            } else {
                Ok(())
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

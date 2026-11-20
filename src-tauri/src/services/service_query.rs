use crate::errors::AppError;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::services::process_runner;

#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub installed: bool,
    pub running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ServiceState {
    #[default]
    Unknown,
    Stopped,
    StartPending,
    Running,
    StopPending,
}

pub fn parse_sc_query(stdout: &str) -> ServiceState {
    let lower = stdout.to_ascii_lowercase();
    if lower.contains("run_pending") || lower.contains("start_pending") {
        ServiceState::StartPending
    } else if lower.contains("stop_pending") {
        ServiceState::StopPending
    } else if lower.contains("running") {
        ServiceState::Running
    } else if lower.contains("stopped") {
        ServiceState::Stopped
    } else {
        ServiceState::Unknown
    }
}

pub async fn query_service(name: &str) -> Result<ServiceStatus, AppError> {
    let mut cmd = Command::new("sc");
    cmd.args(["query", name]).creation_flags(0x0800_0000);
    let result =
        process_runner::run(cmd, Duration::from_secs(4), CancellationToken::new(), None).await?;
    match result.exit_code {
        Some(0) => {
            let state = parse_sc_query(&result.stdout);
            Ok(ServiceStatus {
                installed: true,
                running: state == ServiceState::Running,
            })
        }

        Some(1060) => Ok(ServiceStatus {
            installed: false,
            running: false,
        }),
        Some(code) => Err(AppError::new(
            "SERVICE_QUERY_FAILED",
            "Не удалось получить состояние службы",
        )
        .with_details(serde_json::json!({ "exitCode": code, "stderr": result.stderr }))),
        None => Err(AppError::new(
            "SERVICE_QUERY_KILLED",
            "Запрос состояния службы был прерван",
        )),
    }
}

pub struct CachedServiceStatus {
    name: String,
    cache: Mutex<Option<(ServiceStatus, Instant)>>,
    ttl: Duration,
}

impl CachedServiceStatus {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            cache: Mutex::new(None),
            ttl: Duration::from_secs(2),
        }
    }

    pub async fn get(&self) -> Result<ServiceStatus, AppError> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some((status, at)) = cache.as_ref() {
                if at.elapsed() < self.ttl {
                    return Ok(status.clone());
                }
            }
        }
        let fresh = query_service(&self.name).await?;
        *self.cache.lock().unwrap() = Some((fresh.clone(), Instant::now()));
        Ok(fresh)
    }

    pub fn invalidate(&self) {
        *self.cache.lock().unwrap() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_running_state() {
        let out = "SERVICE_NAME: zapret\r\n        STATE              : 4  RUNNING\r\n";
        assert_eq!(parse_sc_query(out), ServiceState::Running);
    }

    #[test]
    fn parses_stopped_state() {
        let out = "STATE              : 1  STOPPED";
        assert_eq!(parse_sc_query(out), ServiceState::Stopped);
    }

    #[test]
    fn unknown_when_output_unrecognized() {
        assert_eq!(parse_sc_query("garbage"), ServiceState::Unknown);
    }
}

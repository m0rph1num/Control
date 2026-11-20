use crate::domain::strategy::{parse_strategy_args, GameFilterMode};
use crate::errors::AppError;
use crate::services::events::EventSink;
use crate::services::process_scan;
use crate::services::service_query::{CachedServiceStatus, ServiceStatus};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

pub const ZAPRET_SERVICE_NAME: &str = "zapret";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProtectionState {
    #[default]
    Unknown,
    Stopped,
    Starting,
    Active,
    Stopping,

    ExternalInstance,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionSnapshot {
    pub state: ProtectionState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,

    pub detail: String,

    pub revision: u64,
}

pub struct ZapretService {
    sink: Arc<dyn EventSink>,
    service_status: CachedServiceStatus,
    inner: Mutex<Inner>,
    revision: std::sync::atomic::AtomicU64,
}

#[derive(Default)]
struct Inner {
    own_pid: Option<u32>,

    our_roots: Vec<PathBuf>,
    snapshot: Option<ProtectionSnapshot>,
}

impl ZapretService {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            sink,
            service_status: CachedServiceStatus::new(ZAPRET_SERVICE_NAME),
            inner: Mutex::new(Inner {
                own_pid: None,
                our_roots: Vec::new(),
                snapshot: None,
            }),
            revision: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub async fn set_our_roots(&self, roots: Vec<PathBuf>) {
        self.inner.lock().await.our_roots = roots;
    }

    pub async fn refresh(&self) -> Result<ProtectionSnapshot, AppError> {
        let running = process_scan::running("winws");
        let own_pid = self.inner.lock().await.own_pid;

        let (state, detail) = if own_pid.is_some() && running {
            (
                ProtectionState::Active,
                "Защита активна (экземпляр Control)".to_string(),
            )
        } else if running {
            let svc = match self.service_status.get().await {
                Ok(status) => status,
                Err(error) => {
                    tracing::warn!(
                        error = %error.user_message,
                        "не удалось запросить состояние службы zapret"
                    );
                    ServiceStatus::default()
                }
            };
            if svc.installed && svc.running {
                (
                    ProtectionState::Active,
                    "Защита активна (служба автозапуска)".to_string(),
                )
            } else if self.is_ours_by_path().await {
                (
                    ProtectionState::Active,
                    "Защита активна (экземпляр Control)".to_string(),
                )
            } else {
                (
                    ProtectionState::ExternalInstance,
                    "Обнаружен внешний экземпляр Zapret. Управление из Control заблокировано"
                        .to_string(),
                )
            }
        } else {
            self.service_status.invalidate();
            (ProtectionState::Stopped, "Защита остановлена".to_string())
        };

        Ok(self.apply(state, own_pid, detail).await)
    }

    async fn is_ours_by_path(&self) -> bool {
        let roots = self.inner.lock().await.our_roots.clone();
        if roots.is_empty() {
            return false;
        }
        process_scan::list("winws")
            .iter()
            .filter_map(|entry| entry.path.as_deref())
            .any(|path| {
                let lower = path.to_lowercase();
                roots
                    .iter()
                    .any(|r| starts_with_dir(&lower, &r.to_string_lossy().to_lowercase()))
            })
    }

    async fn apply(
        &self,
        state: ProtectionState,
        pid: Option<u32>,
        detail: String,
    ) -> ProtectionSnapshot {
        let mut inner = self.inner.lock().await;
        inner.snapshot = Some(ProtectionSnapshot {
            state,
            pid,
            detail,
            revision: self
                .revision
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1,
        });
        let snap = inner.snapshot.clone().expect("снапшот только что записан");
        drop(inner);
        self.sink.emit_json(
            "protection://state",
            serde_json::to_value(&snap).unwrap_or_default(),
        );
        snap
    }

    pub async fn snapshot(&self) -> ProtectionSnapshot {
        let guard = self.inner.lock().await;
        if let Some(snap) = &guard.snapshot {
            return snap.clone();
        }
        drop(guard);
        self.refresh().await.unwrap_or_else(|e| ProtectionSnapshot {
            state: ProtectionState::Unknown,
            pid: None,
            detail: e.user_message,
            revision: 0,
        })
    }

    pub fn service_status(&self) -> &CachedServiceStatus {
        &self.service_status
    }

    pub fn notify(&self, title: &str, body: &str) {
        self.sink.notify(title, body);
    }

    pub async fn set_own_pid(&self, pid: Option<u32>) {
        self.inner.lock().await.own_pid = pid;
    }

    pub async fn set_transition(&self, starting: bool, message: &str) {
        let (state, detail) = if starting {
            (ProtectionState::Starting, message.to_string())
        } else {
            (ProtectionState::Stopping, message.to_string())
        };
        self.apply(state, None, detail).await;
    }

    #[allow(dead_code)]
    pub async fn set_error(&self, detail: String) {
        self.apply(ProtectionState::Error, None, detail).await;
    }
}

fn starts_with_dir(path_lower: &str, root_lower: &str) -> bool {
    path_lower == root_lower || path_lower.starts_with(&format!("{root_lower}\\"))
}

pub fn parse_strategy_file(
    path: &Path,
    dir: &Path,
    game_mode: GameFilterMode,
) -> Result<crate::domain::strategy::ParsedStrategy, AppError> {
    let content = std::fs::read_to_string(path).map_err(|e| {
        AppError::new(
            "STRATEGY_READ_FAILED",
            "Не удалось прочитать файл стратегии",
        )
        .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(parse_strategy_args(&content, dir, game_mode))
}

pub async fn windivert_status() -> Result<ServiceStatus, AppError> {
    let mut cmd = tokio::process::Command::new("sc");
    cmd.args(["query", "WinDivert"]).creation_flags(0x0800_0000);
    let result = crate::services::process_runner::run(
        cmd,
        std::time::Duration::from_secs(4),
        tokio_util::sync::CancellationToken::new(),
        None,
    )
    .await?;
    match result.exit_code {
        Some(0) => Ok(ServiceStatus {
            installed: true,
            running: crate::services::service_query::parse_sc_query(&result.stdout)
                == crate::services::service_query::ServiceState::Running,
        }),
        Some(1060) => Ok(ServiceStatus {
            installed: false,
            running: false,
        }),
        _ => Ok(ServiceStatus {
            installed: false,
            running: false,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_prefix_matching_is_strict() {
        assert!(starts_with_dir("c:\\zapret\\v1", "c:\\zapret"));
        assert!(!starts_with_dir("c:\\zapret-other\\v1", "c:\\zapret"));
        assert!(starts_with_dir("c:\\zapret", "c:\\zapret"));
    }
}

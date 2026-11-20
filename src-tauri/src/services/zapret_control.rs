use crate::domain::strategy::{split_args, GameFilterMode};
use crate::errors::AppError;
use crate::services::operations::{
    OperationError, OperationHandle, OperationManager, OperationStatus,
};
use crate::services::zapret::{parse_strategy_file, ProtectionState, ZapretService};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{Child, Command};

const WATCHDOG_MAX_ATTEMPTS: u32 = 3;
const WATCHDOG_RESTART_DELAY: Duration = Duration::from_secs(2);
const START_PROBE_DELAY: Duration = Duration::from_millis(1500);
const SUPERVISOR_INTERVAL: Duration = Duration::from_millis(500);

fn error_snapshot(e: AppError) -> crate::services::zapret::ProtectionSnapshot {
    crate::services::zapret::ProtectionSnapshot {
        state: ProtectionState::Error,
        pid: None,
        detail: e.user_message,
        revision: 0,
    }
}

#[derive(Default)]
struct ChildState {
    child: Option<Child>,
    pid: Option<u32>,
    watchdog_attempts: u32,
    stopping_manually: bool,
}

#[derive(Clone)]
struct LaunchSpec {
    strategy_path: PathBuf,
    version_dir: PathBuf,
    game_mode: GameFilterMode,
}

pub struct ZapretControl {
    operations: Arc<OperationManager>,
    status: Arc<ZapretService>,
    child: tokio::sync::Mutex<ChildState>,
    last_launch: tokio::sync::Mutex<Option<LaunchSpec>>,

    reconfigure_scheduled: AtomicBool,
}

impl ZapretControl {
    pub fn new(operations: Arc<OperationManager>, status: Arc<ZapretService>) -> Self {
        Self {
            operations,
            status,
            child: tokio::sync::Mutex::new(ChildState::default()),
            last_launch: tokio::sync::Mutex::new(None),
            reconfigure_scheduled: AtomicBool::new(false),
        }
    }

    pub fn spawn_supervisor(self: &Arc<Self>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(SUPERVISOR_INTERVAL).await;
                if let Some(pid) = this.poll_child_exit().await {
                    this.clone().on_child_exit(pid).await;
                }
            }
        });
    }

    async fn poll_child_exit(&self) -> Option<u32> {
        let mut st = self.child.lock().await;
        let child = st.child.as_mut()?;
        let exited = child.try_wait().ok().flatten().is_some();
        if exited {
            let pid = st.pid.take();
            st.child = None;
            pid
        } else {
            None
        }
    }

    pub async fn start(
        self: &Arc<Self>,
        strategy_path: PathBuf,
        version_dir: PathBuf,
        game_mode: GameFilterMode,
    ) -> Result<String, AppError> {
        let handle = self
            .operations
            .begin("protection_start", Some("winws"), false)
            .await?;
        let id = handle.snapshot.borrow().id.to_string();
        let spec = LaunchSpec {
            strategy_path,
            version_dir,
            game_mode,
        };
        self.run_start(handle, spec).await;
        Ok(id)
    }

    async fn run_start(self: &Arc<Self>, handle: OperationHandle, spec: LaunchSpec) {
        let snapshot = handle.snapshot.borrow().clone();
        self.status.set_transition(true, "Запуск защиты…").await;

        let result = self.try_spawn(&spec).await;

        let mut final_snapshot = snapshot;
        final_snapshot.revision += 1;
        match result {
            Ok(pid) => {
                self.status.set_own_pid(Some(pid)).await;
                let snap = self.status.refresh().await.unwrap_or_else(error_snapshot);
                final_snapshot.status = OperationStatus::Succeeded;
                final_snapshot.message = snap.detail;
                {
                    let mut st = self.child.lock().await;
                    st.watchdog_attempts = 0;
                    st.stopping_manually = false;
                }
                *self.last_launch.lock().await = Some(spec);
                self.status.notify(
                    "Защита запущена",
                    "Zapret работает: трафик обходит DPI-блокировки.",
                );
            }
            Err(err) => {
                final_snapshot.status = OperationStatus::Failed;
                final_snapshot.message = err.user_message.clone();
                final_snapshot.error = Some(err.into());
                let _ = self.status.refresh().await;
                self.status
                    .notify("Защита не запустилась", &final_snapshot.message);
            }
        }
        self.operations.finish(final_snapshot, Some("winws")).await;
    }

    pub fn request_reconfigure(self: &Arc<Self>) {
        if self.reconfigure_scheduled.swap(true, Ordering::SeqCst) {
            return;
        }
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            this.reconfigure_scheduled.store(false, Ordering::SeqCst);
            if let Err(e) = this.reconfigure_now().await {
                tracing::warn!(
                    error = %e.user_message,
                    "live-apply: не удалось применить настройки"
                );
            }
        });
    }

    pub async fn reconfigure_with(
        self: &Arc<Self>,
        strategy_path: PathBuf,
        version_dir: PathBuf,
        game_mode: GameFilterMode,
    ) -> Result<bool, AppError> {
        let spec = LaunchSpec {
            strategy_path,
            version_dir,
            game_mode,
        };
        let active = self.child.lock().await.pid.is_some();
        *self.last_launch.lock().await = Some(spec);
        if !active {
            return Ok(false);
        }
        self.reconfigure_now().await?;
        Ok(true)
    }

    pub async fn reconfigure_now(self: &Arc<Self>) -> Result<(), AppError> {
        let active = self.child.lock().await.pid.is_some();
        if !active {
            return Ok(());
        }
        let Some(spec) = self.last_launch.lock().await.clone() else {
            return Ok(());
        };

        let handle = self
            .operations
            .begin("protection_reconfigure", Some("winws"), false)
            .await?;
        let mut snapshot = handle.snapshot.borrow().clone();
        snapshot.status = OperationStatus::Running;
        snapshot.message = "Применяю настройки…".to_string();
        self.operations.update(snapshot.clone()).await;
        self.status
            .set_transition(true, "Применяю настройки…")
            .await;

        {
            let mut st = self.child.lock().await;
            st.stopping_manually = true;
            st.child = None;
            if let Some(pid) = st.pid.take() {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(0x0800_0000)
                    .output()
                    .await;
            }
        }
        self.status.set_own_pid(None).await;

        tokio::time::sleep(Duration::from_millis(180)).await;

        let result = self.try_spawn(&spec).await;
        snapshot.revision += 1;
        {
            let mut st = self.child.lock().await;
            st.stopping_manually = false;
        }
        match result {
            Ok(pid) => {
                self.status.set_own_pid(Some(pid)).await;
                {
                    let mut st = self.child.lock().await;
                    st.watchdog_attempts = 0;
                }
                *self.last_launch.lock().await = Some(spec);
                let snap = self.status.refresh().await.unwrap_or_else(error_snapshot);
                snapshot.status = OperationStatus::Succeeded;
                snapshot.message = format!("Настройки применены. {}", snap.detail);
            }
            Err(err) => {
                snapshot.status = OperationStatus::Failed;
                snapshot.message = err.user_message.clone();
                snapshot.error = Some(err.into());
                let _ = self.status.refresh().await;
            }
        }
        self.operations.finish(snapshot, Some("winws")).await;
        Ok(())
    }

    async fn try_spawn(&self, spec: &LaunchSpec) -> Result<u32, AppError> {
        let snap = self.status.refresh().await?;
        if snap.state == ProtectionState::ExternalInstance {
            return Err(AppError::new(
                "EXTERNAL_INSTANCE",
                "Запущен внешний экземпляр Zapret. Остановите его или выберите его папку в настройках",
            ));
        }

        let parsed = parse_strategy_file(&spec.strategy_path, &spec.version_dir, spec.game_mode)?;
        if !parsed.bin_path.is_file() {
            return Err(AppError::new(
                "WINWS_MISSING",
                "winws.exe не найден в выбранной версии. Переустановите версию",
            ));
        }

        let mut cmd = Command::new(&parsed.bin_path);
        cmd.args(split_args(&parsed.args.join(" ")))
            .current_dir(&spec.version_dir)
            .creation_flags(0x0800_0000)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let child = cmd.spawn().map_err(|e| {
            AppError::new("PROCESS_SPAWN_FAILED", "Не удалось запустить winws.exe")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;

        let pid = child.id();
        {
            let mut st = self.child.lock().await;
            st.child = Some(child);
            st.pid = Some(pid.expect("spawned child always has a pid"));
        }

        tokio::time::sleep(START_PROBE_DELAY).await;
        let still_alive = {
            let mut st = self.child.lock().await;
            match st.child.as_mut() {
                Some(c) => c.try_wait().map(|s| s.is_none()).unwrap_or(false),
                None => false,
            }
        };
        if !still_alive {
            let stderr_tail = self.drain_stderr().await;
            let wd = crate::services::zapret::windivert_status()
                .await
                .unwrap_or_default();
            let hint = if wd.installed {
                ""
            } else {
                " Драйвер WinDivert не установлен. Проверьте диагностику."
            };
            return Err(
                AppError::new("START_FAILED", "winws.exe завершился сразу после запуска")
                    .with_details(serde_json::json!({
                        "stderr": stderr_tail,
                        "windivertInstalled": wd.installed,
                        "hint": hint
                    })),
            );
        }
        Ok(pid.expect("spawned child always has a pid"))
    }

    async fn drain_stderr(&self) -> String {
        let mut st = self.child.lock().await;
        let Some(child) = st.child.as_mut() else {
            return String::new();
        };
        let mut buf = String::new();
        if let Some(stderr) = child.stderr.as_mut() {
            use tokio::io::AsyncReadExt;
            let _ = stderr.read_to_string(&mut buf).await;
        }
        st.child = None;
        st.pid = None;
        buf.chars().take(400).collect()
    }

    async fn on_child_exit(self: Arc<Self>, pid: u32) {
        let was_manual = self.child.lock().await.stopping_manually;
        self.status.set_own_pid(None).await;
        let snap = self.status.refresh().await.unwrap_or_else(error_snapshot);
        let attempts = self.child.lock().await.watchdog_attempts;

        let should_watchdog = !was_manual
            && snap.state != ProtectionState::ExternalInstance
            && attempts < WATCHDOG_MAX_ATTEMPTS;

        if should_watchdog {
            self.child.lock().await.watchdog_attempts += 1;
            let spec = self.last_launch.lock().await.clone();
            if let Some(spec) = spec {
                let this = self.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(WATCHDOG_RESTART_DELAY).await;
                    tracing::warn!(pid, "watchdog: перезапуск winws после неожиданного выхода");
                    if let Ok(handle) = this
                        .operations
                        .begin("protection_watchdog_restart", Some("winws"), false)
                        .await
                    {
                        this.run_start(handle, spec).await;
                    }
                });
            }
        } else {
            self.child.lock().await.watchdog_attempts = 0;
        }
    }

    pub async fn stop(self: &Arc<Self>) -> Result<String, AppError> {
        let handle = self
            .operations
            .begin("protection_stop", Some("winws"), false)
            .await?;
        let id = handle.snapshot.borrow().id.to_string();
        let snapshot = handle.snapshot.borrow().clone();
        self.status.set_transition(false, "Остановка защиты…").await;

        {
            let mut st = self.child.lock().await;
            st.stopping_manually = true;
            if let Some(pid) = st.pid.take() {
                let kill = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .creation_flags(0x0800_0000)
                    .output();
                if let Ok(out) = kill.await {
                    if !out.status.success() {
                        tracing::warn!(pid, "taskkill вернул неуспех при остановке");
                    }
                }
            }
            st.child = None;
        }
        self.status.set_own_pid(None).await;
        let snap = self.status.refresh().await.unwrap_or_else(error_snapshot);

        let svc = self.status.service_status().get().await.unwrap_or_default();
        let mut final_snapshot = snapshot;
        final_snapshot.revision += 1;
        if svc.installed && svc.running {
            final_snapshot.status = OperationStatus::Failed;
            final_snapshot.message = "Служба автозапуска zapret всё ещё активна. Остановите службу на странице «Служба и автозапуск»".to_string();
            final_snapshot.error = Some(OperationError::new(
                "SERVICE_RUNNING",
                "Служба zapret активна и требует остановки с правами администратора",
            ));
            self.status.notify(
                "Защита не остановлена",
                "Служба автозапуска zapret всё ещё работает. Остановите её в Control.",
            );
        } else {
            final_snapshot.status = OperationStatus::Succeeded;
            final_snapshot.message = snap.detail;
            self.status.notify(
                "Защита остановлена",
                "Zapret больше не перехватывает трафик.",
            );
        }
        self.operations.finish(final_snapshot, Some("winws")).await;
        Ok(id)
    }
}

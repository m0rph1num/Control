use crate::errors::AppError;
use crate::services::service_query;
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentChecks {
    pub admin: bool,
    pub win_divert_installed: bool,
    pub internet: bool,
    pub dns: bool,
    pub existing_running: bool,
    pub existing_install_path: Option<String>,
    pub default_dir: Option<String>,
}

fn is_admin_blocking() -> bool {
    #[cfg(windows)]
    {
        std::process::Command::new("net")
            .arg("session")
            .creation_flags(0x0800_0000)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn free_space_bytes(path: &str) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            free_to_caller: *mut u64,
            total: *mut u64,
            free_total: *mut u64,
        ) -> i32;
    }

    let mut wide: Vec<u16> = std::ffi::OsStr::new(path).encode_wide().collect();
    wide.push(0);
    let mut free: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0).then_some(free)
}

#[cfg(not(windows))]
fn free_space_bytes(_path: &str) -> Option<u64> {
    None
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

async fn ping_ok(host: &str, timeout: Duration) -> bool {
    let out = tokio::process::Command::new("ping")
        .args(["-n", "1", host])
        .creation_flags(0x0800_0000)
        .output();
    let result = tokio::time::timeout(timeout, out).await;
    matches!(result, Ok(Ok(o)) if o.status.success())
}

async fn nslookup_ok(host: &str, timeout: Duration) -> bool {
    let out = tokio::process::Command::new("nslookup")
        .arg(host)
        .creation_flags(0x0800_0000)
        .output();
    let result = tokio::time::timeout(timeout, out).await;
    matches!(result, Ok(Ok(o)) if o.status.success())
}

fn find_existing_install(control_dir: &str) -> Option<String> {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let program_files = std::env::var("PROGRAMFILES").unwrap_or_default();
    let candidates = [
        "C:\\zapret".to_string(),
        "C:\\zapret-discord-youtube".to_string(),
        format!("{}\\zapret", local),
        format!("{}\\zapret", program_files),
    ];
    candidates.into_iter().find(|p| {
        let path = PathBuf::from(p);
        path.join("bin").join("winws.exe").is_file() && p != control_dir
    })
}

pub fn default_dir_blocking() -> String {
    let docs = std::env::var("USERPROFILE")
        .map(|u| format!("{}\\Documents", u))
        .unwrap_or_else(|_| "C:\\Users".into());
    let user = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users".into());
    let candidates = [
        format!("{}\\Control", docs),
        format!("{}\\Control", user),
        "C:\\Control".to_string(),
    ];
    for c in &candidates {
        if std::fs::create_dir_all(c).is_ok() {
            return c.clone();
        }
    }
    "C:\\Control".to_string()
}

pub async fn run_checks(_state: &crate::state::AppState) -> Result<EnvironmentChecks, AppError> {
    #[cfg(windows)]
    let admin = tokio::task::spawn_blocking(is_admin_blocking)
        .await
        .unwrap_or(false);
    #[cfg(not(windows))]
    let admin = false;

    let (internet, dns, divert, running) = tokio::join!(
        ping_ok("8.8.8.8", Duration::from_secs(3)),
        nslookup_ok("github.com", Duration::from_secs(3)),
        service_query::query_service("WinDivert"),
        async { crate::services::process_scan::running("winws") },
    );
    let win_divert_installed = divert.map(|s| s.installed).unwrap_or(false);
    let existing_running = running;

    let settings = crate::storage::settings::read_settings_raw()?;
    let control_dir = crate::storage::settings::settings_str(&settings, "controlDir")
        .unwrap_or_default()
        .to_string();
    let existing_install_path = {
        let cd = control_dir.clone();
        tokio::task::spawn_blocking(move || find_existing_install(&cd))
            .await
            .unwrap_or(None)
    };

    Ok(EnvironmentChecks {
        admin,
        win_divert_installed,
        internet,
        dns,
        existing_running,
        existing_install_path: existing_install_path.clone(),

        default_dir: existing_install_path,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Pending,
    Running,
    Ok,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: String,
    pub group: String,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub checks: Vec<DiagnosticCheck>,
    pub ok: usize,
    pub warnings: usize,
    pub errors: usize,
    pub generated_at: String,
    pub duration_ms: u64,
    pub context: DiagnosticsContext,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsContext {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub admin: bool,
    pub data_dir: Option<String>,
    pub settings_file: Option<String>,
    pub control_dir: Option<String>,
    pub install_dir: Option<String>,
    pub strategies: usize,
    pub service_installed: bool,
    pub service_running: bool,
    pub windivert_installed: bool,
    pub windivert_running: bool,
    pub tgws_installed: bool,
    pub tgws_running: bool,
    pub tgws_port: u16,
    pub autostart_control: bool,
    pub autostart_zapret: bool,
    pub log_path: Option<String>,
    pub log_tail: Vec<String>,
}

struct CheckDef {
    id: &'static str,
    group: &'static str,
    title: &'static str,
}

const CHECK_DEFS: &[CheckDef] = &[
    CheckDef {
        id: "admin",
        group: "Система",
        title: "Права администратора",
    },
    CheckDef {
        id: "data-dir",
        group: "Система",
        title: "Папка данных Control",
    },
    CheckDef {
        id: "settings",
        group: "Система",
        title: "Файл настроек",
    },
    CheckDef {
        id: "install",
        group: "Zapret",
        title: "Установка Zapret найдена",
    },
    CheckDef {
        id: "winws",
        group: "Zapret",
        title: "Бинарник winws.exe",
    },
    CheckDef {
        id: "strategies",
        group: "Zapret",
        title: "Файлы стратегий",
    },
    CheckDef {
        id: "lists",
        group: "Zapret",
        title: "Пользовательские списки",
    },
    CheckDef {
        id: "fakes",
        group: "Zapret",
        title: "Fake-файлы",
    },
    CheckDef {
        id: "windivert-service",
        group: "WinDivert",
        title: "Служба WinDivert",
    },
    CheckDef {
        id: "windivert-driver",
        group: "WinDivert",
        title: "Драйвер WinDivert",
    },
    CheckDef {
        id: "process",
        group: "Защита",
        title: "Процесс winws.exe",
    },
    CheckDef {
        id: "service",
        group: "Защита",
        title: "Служба автозапуска zapret",
    },
    CheckDef {
        id: "tcp",
        group: "Сеть",
        title: "TCP-соединение (1.1.1.1:443)",
    },
    CheckDef {
        id: "dns",
        group: "Сеть",
        title: "DNS-разрешение",
    },
    CheckDef {
        id: "https",
        group: "Сеть",
        title: "HTTPS-доступ к GitHub",
    },
    CheckDef {
        id: "external",
        group: "Сеть",
        title: "Другая установка Zapret",
    },
    CheckDef {
        id: "tgws",
        group: "TG Proxy",
        title: "TG WS Proxy",
    },
    CheckDef {
        id: "tgws-port",
        group: "TG Proxy",
        title: "Порт локального прокси",
    },
    CheckDef {
        id: "disk",
        group: "Система",
        title: "Свободное место на диске",
    },
];

fn emit_check(state: &crate::state::AppState, check: &DiagnosticCheck) {
    if let Ok(value) = serde_json::to_value(check) {
        state.sink.emit_json("diagnostics://check", value);
    }
}

fn ok(detail: impl Into<String>) -> (CheckStatus, String, Option<String>) {
    (CheckStatus::Ok, detail.into(), None)
}
fn warn(
    detail: impl Into<String>,
    hint: impl Into<String>,
) -> (CheckStatus, String, Option<String>) {
    (CheckStatus::Warning, detail.into(), Some(hint.into()))
}
fn err(
    detail: impl Into<String>,
    hint: impl Into<String>,
) -> (CheckStatus, String, Option<String>) {
    (CheckStatus::Error, detail.into(), Some(hint.into()))
}

async fn run_one(
    id: &str,
    state: std::sync::Arc<crate::state::AppState>,
) -> (CheckStatus, String, Option<String>) {
    let settings = crate::storage::settings::read_settings_raw().ok();
    let dir = settings
        .as_ref()
        .and_then(crate::storage::settings::find_flowseal_dir);

    match id {
        "admin" => {
            #[cfg(windows)]
            let admin = tokio::task::spawn_blocking(is_admin_blocking)
                .await
                .unwrap_or(false);
            #[cfg(not(windows))]
            let admin = false;
            if admin {
                ok("Права администратора получены")
            } else {
                warn(
                    "Работа без прав администратора",
                    "Это нормально для обычного запуска. Права нужны только для установки службы zapret и WinDivert.",
                )
            }
        }
        "data-dir" => match crate::storage::settings::app_data_dir() {
            Ok(dir) => {
                let probe = dir.join(format!(".diag-{}", uuid::Uuid::new_v4().simple()));
                match std::fs::write(&probe, b"control") {
                    Ok(()) => {
                        let _ = std::fs::remove_file(&probe);
                        ok(dir.to_string_lossy().into_owned())
                    }
                    Err(e) => err(
                        "Папка данных недоступна для записи",
                        format!("{e}. Проверьте права на %APPDATA%\\control"),
                    ),
                }
            }
            Err(e) => err(e.user_message, "Переменная APPDATA не найдена"),
        },
        "settings" => match crate::storage::settings::read_settings_recovering() {
            Ok(snapshot) => {
                let keys = snapshot.content.as_object().map(|o| o.len()).unwrap_or(0);
                let selected = crate::storage::settings::settings_str(&snapshot.content, "selectedVersion")
                    .unwrap_or("не выбрана")
                    .to_string();
                ok(format!("Настройки читаются · ключей: {keys} · версия: {selected}"))
            }
            Err(e) => err(e.user_message, "Файл настроек повреждён. Бэкап можно восстановить на вкладке «Бэкап»"),
        },
        "install" => match &dir {
            Some(dir) => ok(dir.to_string_lossy().into_owned()),
            None => err(
                "Активная установка Zapret не найдена",
                "Установите версию на вкладке «Версии» или выберите папку в мастере",
            ),
        },
        "winws" => match &dir {
            Some(dir) => {
                let path = dir.join("bin").join("winws.exe");
                match std::fs::metadata(&path) {
                    Ok(meta) if meta.is_file() => ok(format!(
                        "{} · {:.1} МБ",
                        path.to_string_lossy(),
                        meta.len() as f64 / 1_048_576.0
                    )),
                    _ => err(
                        "bin\\winws.exe не найден в активной версии",
                        "Переустановите версию Zapret — файл winws.exe обязателен",
                    ),
                }
            }
            None => warn("Проверка пропущена: нет установки", "Сначала установите Zapret"),
        },
        "strategies" => match &dir {
            Some(dir) => {
                let list = crate::storage::settings::list_strategies(dir);
                if list.is_empty() {
                    err(
                        "В папке версии нет .bat-стратегий",
                        "Переустановите версию или создайте профиль вручную",
                    )
                } else {
                    ok(format!("Найдено стратегий: {}", list.len()))
                }
            }
            None => warn("Проверка пропущена: нет установки", "Сначала установите Zapret"),
        },
        "lists" => match &dir {
            Some(dir) => match crate::services::filters::lists_get(dir) {
                Ok(lists) => {
                    let existing = lists.iter().filter(|l| l.exists).count();
                    let non_empty = lists.iter().filter(|l| l.exists && !l.content.trim().is_empty()).count();
                    if existing == 0 {
                        warn(
                            "Пользовательские списки не созданы",
                            "Они создаются автоматически при выборе версии или сохранении профиля",
                        )
                    } else {
                        ok(format!("Файлов: {existing} из {} · непустых: {non_empty}", lists.len()))
                    }
                }
                Err(e) => err(e.user_message, "Не удалось прочитать папку lists"),
            },
            None => warn("Проверка пропущена: нет установки", "Сначала установите Zapret"),
        },
        "fakes" => match &dir {
            Some(dir) => {
                let info = crate::services::filters::fakes_get(dir);
                if info.fakes.is_empty() {
                    warn(
                        "Fake-файлы не найдены",
                        "Проверьте папку fakes в версии Zapret",
                    )
                } else {
                    let discord = info.current_discord.as_deref().unwrap_or("не выбран");
                    let game = info.current_game.as_deref().unwrap_or("не выбран");
                    ok(format!(
                        "Доступно: {} · Discord: {discord} · игры: {game}",
                        info.fakes.len()
                    ))
                }
            }
            None => warn("Проверка пропущена: нет установки", "Сначала установите Zapret"),
        },
        "windivert-service" => match crate::services::zapret::windivert_status().await {
            Ok(status) if status.running => ok("Служба WinDivert запущена"),
            Ok(status) if status.installed => warn(
                "Служба WinDivert установлена, но остановлена",
                "Она запустится автоматически при старте защиты. Если нет — переустановите WinDivert",
            ),
            Ok(_) => err(
                "Служба WinDivert не установлена",
                "Установите WinDivert (обычно идёт вместе с Zapret) с правами администратора",
            ),
            Err(e) => err(e.user_message, "Не удалось запросить состояние службы"),
        },
        "windivert-driver" => {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Some(dir) = &dir {
                candidates.push(dir.join("WinDivert.dll"));
                candidates.push(dir.join("WinDivert64.sys"));
                if let Some(bin) = dir.join("bin").join("WinDivert.dll").to_str() {
                    candidates.push(PathBuf::from(bin));
                }
            }
            if let Ok(windir) = std::env::var("WINDIR") {
                candidates.push(PathBuf::from(&windir).join("System32").join("drivers").join("WinDivert64.sys"));
                candidates.push(PathBuf::from(&windir).join("System32").join("drivers").join("WinDivert.sys"));
            }
            match candidates.into_iter().find(|p| p.is_file()) {
                Some(path) => ok(path.to_string_lossy().into_owned()),
                None => warn(
                    "Файл драйвера WinDivert не найден рядом с версией",
                    "Драйвер может быть установлен системно. Если защита не стартует — переустановите WinDivert",
                ),
            }
        }
        "process" => {
            let entries = crate::services::process_scan::list("winws");
            match entries.first() {
                Some(entry) => {
                    let where_ = entry
                        .path
                        .clone()
                        .unwrap_or_else(|| "путь недоступен без прав администратора".into());
                    ok(format!("winws.exe работает · PID {} · {where_}", entry.pid))
                }
                None => warn(
                    "winws.exe не запущен",
                    "Это ожидаемо, если защита выключена. Запустите её на вкладке «Защита»",
                ),
            }
        }
        "service" => match state.zapret.service_status().get().await {
            Ok(status) if status.running => ok("Служба zapret запущена"),
            Ok(status) if status.installed => warn(
                "Служба zapret установлена, но остановлена",
                "Запустите её в «Диагностике» или удалите, если не нужна",
            ),
            Ok(_) => ok("Служба zapret не установлена (запуск через Control)"),
            Err(e) => err(e.user_message, "Не удалось запросить состояние службы"),
        },
        "tcp" => match tokio::time::timeout(
            Duration::from_secs(4),
            tokio::net::TcpStream::connect(("1.1.1.1", 443)),
        )
        .await
        {
            Ok(Ok(_)) => ok("Соединение установлено за отведённое время"),
            Ok(Err(e)) => err(
                format!("Не удалось подключиться: {e}"),
                "Проверьте интернет, VPN и правила брандмауэра",
            ),
            Err(_) => err("Таймаут подключения (4 с)", "Сеть недоступна или блокируется"),
        },
        "dns" => match tokio::time::timeout(
            Duration::from_secs(4),
            tokio::net::lookup_host(("github.com", 443)),
        )
        .await
        {
            Ok(Ok(addrs)) => {
                let addrs: Vec<_> = addrs.collect();
                if addrs.is_empty() {
                    err("DNS вернул пустой ответ", "Смените DNS-сервер или проверьте VPN")
                } else {
                    ok(format!("github.com → {}", addrs[0].ip()))
                }
            }
            Ok(Err(e)) => err(format!("Ошибка DNS: {e}"), "Проверьте настройки DNS"),
            Err(_) => err("Таймаут DNS (4 с)", "DNS-сервер не отвечает"),
        },
        "https" => {
            let result = tokio::task::spawn_blocking(|| -> Result<u16, String> {
                let agent = ureq::AgentBuilder::new()
                    .timeout_connect(Duration::from_secs(8))
                    .timeout(Duration::from_secs(12))
                    .build();
                match agent
                    .get("https://api.github.com/repos/Flowseal/zapret-discord-youtube")
                    .set("User-Agent", "Control-App")
                    .call()
                {
                    Ok(response) => Ok(response.status()),
                    Err(ureq::Error::Status(code, _)) => Ok(code),
                    Err(e) => Err(e.to_string()),
                }
            })
            .await;
            match result {
                Ok(Ok(code)) if (200..400).contains(&code) => ok(format!("GitHub ответил HTTP {code}")),
                Ok(Ok(code)) => warn(
                    format!("GitHub ответил HTTP {code}"),
                    "Сервер доступен, но вернул нестандартный код",
                ),
                Ok(Err(e)) if is_timeout(&e) => err(
                    "HTTPS-запрос не выполнен: таймаут",
                    "Провайдер блокирует GitHub. Включите защиту zapret или VPN, затем повторите",
                ),
                Ok(Err(e)) => err(
                    "HTTPS-запрос не выполнен",
                    format!("{e}. Включите защиту zapret или VPN, затем повторите"),
                ),
                Err(e) => err(
                    "HTTPS-проверка завершилась аварийно",
                    format!("{e}"),
                ),
            }
        }
        "external" => {
            let control_dir = settings
                .as_ref()
                .and_then(|s| crate::storage::settings::settings_str(s, "controlDir"))
                .unwrap_or_default()
                .to_string();
            let found = tokio::task::spawn_blocking(move || find_existing_install(&control_dir))
                .await
                .unwrap_or(None);
            match found {
                Some(path) => warn(
                    format!("Найдена другая установка: {path}"),
                    "Убедитесь, что не запущены два экземпляра winws одновременно",
                ),
                None => ok("Конфликтующих установок не найдено"),
            }
        }
        "tgws" => {
            let st = crate::services::tgws::status().await;
            if st.running {
                ok(format!("Запущен · порт {}", st.port))
            } else if st.installed {
                warn(
                    "Установлен, но не запущен",
                    "Запустите на вкладке «TG Proxy» — он работает независимо от Zapret",
                )
            } else {
                warn(
                    "TG WS Proxy не установлен",
                    "Скачайте его на вкладке «TG Proxy» (необязательный компонент)",
                )
            }
        }
        "tgws-port" => {
            let st = crate::services::tgws::status().await;
            let target = ("127.0.0.1", st.port);
            match tokio::time::timeout(
                Duration::from_secs(2),
                tokio::net::TcpStream::connect(target),
            )
            .await
            {
                Ok(Ok(_)) => ok(format!("127.0.0.1:{} слушает", st.port)),
                _ => warn(
                    format!("127.0.0.1:{} свободен", st.port),
                    "Если TG WS Proxy запущен, порт должен быть занят. Проверьте конфиг прокси",
                ),
            }
        }
        "disk" => {
            let free = tokio::task::spawn_blocking(|| {
                let root = crate::storage::settings::app_data_dir()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| "C:\\".to_string());
                free_space_bytes(&root)
            })
            .await
            .ok()
            .flatten();
            match free {
                Some(bytes) if bytes > 1024 * 1024 * 1024 => {
                    ok(format!("Свободно {:.1} ГБ", bytes as f64 / 1_073_741_824.0))
                }
                Some(bytes) => warn(
                    format!("Свободно {:.0} МБ", bytes as f64 / 1_048_576.0),
                    "Освободите место: обновления Zapret требуют ~100 МБ",
                ),
                None => warn(
                    "Не удалось определить свободное место",
                    "Проверка не критична для работы",
                ),
            }
        }
        _ => unknown("Неизвестная проверка", "Внутренняя ошибка списка проверок"),
    }
}

fn unknown(
    detail: impl Into<String>,
    hint: impl Into<String>,
) -> (CheckStatus, String, Option<String>) {
    (CheckStatus::Error, detail.into(), Some(hint.into()))
}

fn is_timeout(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("10060")
        || lower.contains("10054")
        || lower.contains("connection failed")
}

const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const CHECK_CONCURRENCY: usize = 4;

enum CheckUpdate {
    Running,
    Done(CheckStatus, String, Option<String>, u64),
}

pub async fn run_deep(
    state: std::sync::Arc<crate::state::AppState>,
) -> Result<DiagnosticsReport, AppError> {
    let started = Instant::now();
    let mut checks: Vec<DiagnosticCheck> = CHECK_DEFS
        .iter()
        .map(|d| DiagnosticCheck {
            id: d.id.into(),
            group: d.group.into(),
            title: d.title.into(),
            status: CheckStatus::Pending,
            detail: "Ожидает запуска".into(),
            hint: None,
            duration_ms: 0,
        })
        .collect();
    for check in &checks {
        emit_check(&state, check);
    }

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(usize, CheckUpdate)>();
    let limit = std::sync::Arc::new(tokio::sync::Semaphore::new(CHECK_CONCURRENCY));

    for (idx, def) in CHECK_DEFS.iter().enumerate() {
        let tx = tx.clone();
        let state = state.clone();
        let limit = limit.clone();
        let id = def.id;
        tokio::spawn(async move {
            let Ok(_permit) = limit.acquire_owned().await else {
                return;
            };
            let check_started = Instant::now();
            let _ = tx.send((idx, CheckUpdate::Running));
            let task_state = state.clone();
            let mut task = tokio::spawn(async move { run_one(id, task_state).await });
            let outcome = tokio::time::timeout(CHECK_TIMEOUT, &mut task).await;
            let (status, detail, hint) = match outcome {
                Ok(Ok(value)) => value,
                Ok(Err(join)) => (
                    CheckStatus::Error,
                    format!("Проверка завершилась аварийно: {join}"),
                    Some("Приложите отчёт диагностики к обращению в поддержку".to_string()),
                ),
                Err(_) => {
                    task.abort();
                    (
                        CheckStatus::Error,
                        format!("Проверка не уложилась в {} с", CHECK_TIMEOUT.as_secs()),
                        Some("Проверка прервана, чтобы не блокировать остальные".to_string()),
                    )
                }
            };
            let duration = check_started.elapsed().as_millis().min(u64::MAX as u128) as u64;
            let _ = tx.send((idx, CheckUpdate::Done(status, detail, hint, duration)));
        });
    }
    drop(tx);

    while let Some((idx, update)) = rx.recv().await {
        match update {
            CheckUpdate::Running => {
                checks[idx].status = CheckStatus::Running;
                checks[idx].detail = "Выполняется…".into();
            }
            CheckUpdate::Done(status, detail, hint, duration) => {
                checks[idx].status = status;
                checks[idx].detail = detail;
                checks[idx].hint = hint;
                checks[idx].duration_ms = duration;
            }
        }
        emit_check(&state, &checks[idx]);
    }

    let ok_count = checks
        .iter()
        .filter(|c| c.status == CheckStatus::Ok)
        .count();
    let warnings = checks
        .iter()
        .filter(|c| c.status == CheckStatus::Warning)
        .count();
    let errors = checks
        .iter()
        .filter(|c| c.status == CheckStatus::Error)
        .count();
    let duration_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    let context = collect_context(&state).await;

    let mut report = DiagnosticsReport {
        checks,
        ok: ok_count,
        warnings,
        errors,
        generated_at: chrono::Utc::now().to_rfc3339(),
        duration_ms,
        context,
        markdown: String::new(),
    };
    report.markdown = build_markdown(&report);
    Ok(report)
}

fn os_info() -> (String, String) {
    let arch = std::env::var("PROCESSOR_ARCHITECTURE")
        .unwrap_or_else(|_| std::env::consts::ARCH.to_uppercase());
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "ver"]).creation_flags(0x0800_0000);
        if let Ok(out) = cmd.output() {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() {
                return (text, arch);
            }
        }
    }
    (std::env::consts::OS.to_string(), arch)
}

async fn collect_context(state: &crate::state::AppState) -> DiagnosticsContext {
    let admin = tokio::task::spawn_blocking(is_admin_blocking)
        .await
        .unwrap_or(false);
    let autostart_control = tokio::task::spawn_blocking(crate::services::autostart::is_enabled)
        .await
        .unwrap_or(false);
    let (os, arch) = tokio::task::spawn_blocking(os_info)
        .await
        .unwrap_or_else(|_| {
            (
                std::env::consts::OS.to_string(),
                std::env::consts::ARCH.to_string(),
            )
        });

    let settings = crate::storage::settings::read_settings_raw().ok();
    let control_dir = settings
        .as_ref()
        .and_then(|s| crate::storage::settings::settings_str(s, "controlDir"))
        .map(str::to_string);
    let install_dir = settings
        .as_ref()
        .and_then(crate::storage::settings::find_flowseal_dir);
    let strategies = install_dir
        .as_ref()
        .map(|dir| crate::storage::settings::list_strategies(dir).len())
        .unwrap_or(0);

    let (service, windivert, tgws) = tokio::join!(
        service_query::query_service(crate::services::zapret_service::ZAPRET_SERVICE_NAME),
        service_query::query_service(crate::services::zapret_service::WINDIVERT_SERVICE_NAME),
        crate::services::tgws::status(),
    );
    let service = service.unwrap_or_default();
    let windivert = windivert.unwrap_or_default();

    DiagnosticsContext {
        app_version: state.version.clone(),
        os,
        arch,
        admin,
        data_dir: crate::storage::settings::app_data_dir()
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
        settings_file: crate::storage::settings::settings_path()
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
        control_dir,
        install_dir: install_dir.map(|p| p.to_string_lossy().into_owned()),
        strategies,
        service_installed: service.installed,
        service_running: service.running,
        windivert_installed: windivert.installed,
        windivert_running: windivert.running,
        tgws_installed: tgws.installed,
        tgws_running: tgws.running,
        tgws_port: tgws.port,
        autostart_control,
        autostart_zapret: service.installed,
        log_path: crate::services::logging::path().map(|p| p.to_string_lossy().into_owned()),
        log_tail: crate::services::logging::tail(60),
    }
}

fn status_mark(status: &CheckStatus) -> &'static str {
    match status {
        CheckStatus::Ok => "✅",
        CheckStatus::Warning => "⚠️",
        CheckStatus::Error => "❌",
        CheckStatus::Running => "⏳",
        CheckStatus::Pending => "·",
    }
}

fn status_word(status: &CheckStatus) -> &'static str {
    match status {
        CheckStatus::Ok => "OK",
        CheckStatus::Warning => "WARNING",
        CheckStatus::Error => "ERROR",
        CheckStatus::Running => "RUNNING",
        CheckStatus::Pending => "PENDING",
    }
}

fn one_line(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn flag(value: bool) -> &'static str {
    if value {
        "да"
    } else {
        "нет"
    }
}

fn build_markdown(report: &DiagnosticsReport) -> String {
    let ctx = &report.context;
    let mut out = String::new();

    out.push_str("# Control · отчёт диагностики\n\n");
    out.push_str(&format!("- Сформирован: {}\n", report.generated_at));
    out.push_str(&format!("- Версия Control: {}\n", ctx.app_version));
    out.push_str(&format!("- ОС: {} · {}\n", ctx.os, ctx.arch));
    out.push_str(&format!("- Права администратора: {}\n", flag(ctx.admin)));
    out.push_str(&format!(
        "- Папка данных: {}\n",
        ctx.data_dir.as_deref().unwrap_or("—")
    ));
    out.push_str(&format!(
        "- Файл настроек: {}\n",
        ctx.settings_file.as_deref().unwrap_or("—")
    ));
    out.push_str(&format!(
        "- Папка Control: {}\n",
        ctx.control_dir.as_deref().unwrap_or("—")
    ));
    out.push_str(&format!(
        "- Установка Zapret: {}\n",
        ctx.install_dir.as_deref().unwrap_or("—")
    ));
    out.push_str(&format!("- Стратегий найдено: {}\n", ctx.strategies));
    out.push_str(&format!(
        "- Служба zapret: установлена — {}, запущена — {}\n",
        flag(ctx.service_installed),
        flag(ctx.service_running)
    ));
    out.push_str(&format!(
        "- WinDivert: установлен — {}, запущен — {}\n",
        flag(ctx.windivert_installed),
        flag(ctx.windivert_running)
    ));
    out.push_str(&format!(
        "- TG WS Proxy: установлен — {}, запущен — {}, порт {}\n",
        flag(ctx.tgws_installed),
        flag(ctx.tgws_running),
        ctx.tgws_port
    ));
    out.push_str(&format!(
        "- Автозапуск Control: {}\n",
        flag(ctx.autostart_control)
    ));
    out.push_str(&format!(
        "- Автозапуск zapret (служба Windows): {}\n",
        flag(ctx.autostart_zapret)
    ));
    out.push_str(&format!(
        "- Журнал: {}\n",
        ctx.log_path.as_deref().unwrap_or("—")
    ));
    out.push_str(&format!(
        "\nИтог: {} OK · {} замечаний · {} ошибок · {:.1} с\n\n",
        report.ok,
        report.warnings,
        report.errors,
        report.duration_ms as f64 / 1000.0
    ));

    let issues: Vec<&DiagnosticCheck> = report
        .checks
        .iter()
        .filter(|c| matches!(c.status, CheckStatus::Warning | CheckStatus::Error))
        .collect();
    if issues.is_empty() {
        out.push_str("## Проблемы\n\nПроблем не обнаружено.\n\n");
    } else {
        out.push_str("## Проблемы\n\n");
        for check in issues {
            out.push_str(&format!(
                "{} **{}** (`{}`, {})\n",
                status_mark(&check.status),
                check.title,
                check.id,
                status_word(&check.status)
            ));
            out.push_str(&format!("- Группа: {}\n", check.group));
            out.push_str(&format!("- Детали: {}\n", one_line(&check.detail)));
            if let Some(hint) = &check.hint {
                out.push_str(&format!("- Рекомендация: {}\n", one_line(hint)));
            }
            out.push('\n');
        }
    }

    out.push_str("## Все проверки\n\n");
    let mut groups: Vec<&str> = Vec::new();
    for check in &report.checks {
        if !groups.contains(&check.group.as_str()) {
            groups.push(&check.group);
        }
    }
    for group in groups {
        out.push_str(&format!("### {}\n\n", group));
        for check in report.checks.iter().filter(|c| c.group == group) {
            out.push_str(&format!(
                "- {} **{}** (`{}`, {} мс)\n",
                status_mark(&check.status),
                check.title,
                check.id,
                check.duration_ms
            ));
            out.push_str(&format!("  - Статус: {}\n", status_word(&check.status)));
            out.push_str(&format!("  - Детали: {}\n", one_line(&check.detail)));
            if let Some(hint) = &check.hint {
                out.push_str(&format!("  - Рекомендация: {}\n", one_line(hint)));
            }
        }
        out.push('\n');
    }

    if !ctx.log_tail.is_empty() {
        out.push_str("## Журнал Control\n\n````text\n");
        for line in &ctx.log_tail {
            out.push_str(&line.replace("````", "'''"));
            out.push('\n');
        }
        out.push_str("````\n\n");
    }

    let environment = serde_json::json!({
        "appVersion": ctx.app_version,
        "os": ctx.os,
        "arch": ctx.arch,
        "admin": ctx.admin,
        "dataDir": ctx.data_dir,
        "settingsFile": ctx.settings_file,
        "controlDir": ctx.control_dir,
        "installDir": ctx.install_dir,
        "strategies": ctx.strategies,
        "serviceInstalled": ctx.service_installed,
        "serviceRunning": ctx.service_running,
        "windivertInstalled": ctx.windivert_installed,
        "windivertRunning": ctx.windivert_running,
        "tgwsInstalled": ctx.tgws_installed,
        "tgwsRunning": ctx.tgws_running,
        "tgwsPort": ctx.tgws_port,
        "autostartControl": ctx.autostart_control,
        "autostartZapret": ctx.autostart_zapret,
    });
    let summary = serde_json::json!({
        "generatedAt": report.generated_at,
        "durationMs": report.duration_ms,
        "summary": { "ok": report.ok, "warnings": report.warnings, "errors": report.errors },
        "environment": environment,
        "checks": report.checks,
    });
    out.push_str("## Машиночитаемая сводка\n\n```json\n");
    out.push_str(&serde_json::to_string_pretty(&summary).unwrap_or_default());
    out.push_str("\n```\n");

    out
}

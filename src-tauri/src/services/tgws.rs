use crate::errors::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const APP_NAME: &str = "TgWsProxy";
const EXE_NAME: &str = "TgWsProxy_windows.exe";
const REPO: &str = "Flowseal/tg-ws-proxy";
const RELEASE_URL: &str =
    "https://github.com/Flowseal/tg-ws-proxy/releases/download/v1.11.4/TgWsProxy_windows.exe";

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TgwsStatus {
    pub installed: bool,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    pub config_exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exe_path: Option<String>,
    pub autostart: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

static START_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

fn start_lock() -> &'static tokio::sync::Mutex<()> {
    START_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub fn install_dir() -> Result<PathBuf, AppError> {
    let dir = crate::storage::settings::app_data_dir()?.join("tgws");
    std::fs::create_dir_all(&dir).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать папку TG WS Proxy")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(dir)
}

pub fn exe_path() -> Result<PathBuf, AppError> {
    Ok(install_dir()?.join(EXE_NAME))
}

fn data_dir() -> Result<PathBuf, AppError> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| AppError::new("ENV_MISSING", "Не найдена папка данных пользователя"))?;
    Ok(Path::new(&appdata).join(APP_NAME))
}

pub fn config_path() -> Result<PathBuf, AppError> {
    Ok(data_dir()?.join("config.json"))
}

pub fn log_path() -> Result<PathBuf, AppError> {
    Ok(data_dir()?.join("proxy.log"))
}

fn read_config() -> Option<serde_json::Value> {
    let path = config_path().ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_config(value: &serde_json::Value) -> Result<(), AppError> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            AppError::new(
                "IO_ERROR",
                "Не удалось создать папку конфигурации TG WS Proxy",
            )
            .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| {
        AppError::new("INTERNAL", "Не удалось сериализовать конфигурацию прокси")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    std::fs::write(&path, text).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось записать конфигурацию TG WS Proxy")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })
}

fn find_processes() -> Vec<(u32, Option<String>)> {
    crate::services::process_scan::list(EXE_NAME)
        .into_iter()
        .map(|entry| (entry.pid, entry.path))
        .collect()
}

fn owns_process(path: Option<&str>, dir: &Path) -> bool {
    match path {
        None => true,
        Some(p) => {
            let p = p.to_lowercase();
            let d = dir.to_string_lossy().to_lowercase();
            p.starts_with(&d)
        }
    }
}

fn build_status(running: bool, pid: Option<u32>, exe: Option<PathBuf>) -> TgwsStatus {
    let cfg = read_config();
    let host = cfg
        .as_ref()
        .and_then(|c| c.get("host"))
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1")
        .to_string();
    let port = cfg
        .as_ref()
        .and_then(|c| c.get("port"))
        .and_then(|v| v.as_u64())
        .unwrap_or(1443) as u16;
    let secret = cfg
        .as_ref()
        .and_then(|c| c.get("secret"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty());
    let link = secret.as_ref().map(|secret| {
        let link_host = if host == "0.0.0.0" {
            "127.0.0.1"
        } else {
            &host
        };
        format!("tg://proxy?server={link_host}&port={port}&secret={secret}")
    });
    let autostart = cfg
        .as_ref()
        .and_then(|c| c.get("autostart"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    TgwsStatus {
        installed: exe.as_ref().is_some_and(|p| p.is_file()),
        running,
        pid,
        host,
        port,
        secret,
        link,
        config_exists: cfg.is_some(),
        exe_path: exe.map(|p| p.to_string_lossy().into_owned()),
        autostart,
        warning: if running { health_warning() } else { None },
    }
}

fn health_warning() -> Option<String> {
    let path = log_path().ok()?;
    let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
    if modified.elapsed().unwrap_or_default() > Duration::from_secs(180) {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    let recent: Vec<&str> = text.lines().rev().take(80).collect();
    let joined = recent.join("\n");
    if joined.contains("WinError 10048") || joined.contains("Address already in use") {
        return Some(
            "Порт занят другим процессом. Остановите TG WS Proxy и запустите снова".into(),
        );
    }
    let cf_failed = joined.matches("CF proxy failed").count();
    let dc_failed = joined.contains("no fallback available")
        || joined.contains("WS pool unavailable")
        || joined.contains("WS pool refill failed");
    if cf_failed >= 2 && dc_failed {
        return Some(
            "Прокси работает, но не может достучаться до серверов Telegram. Включите защиту zapret: без неё провайдер блокирует соединения с DC и Cloudflare".into(),
        );
    }
    None
}

async fn kill_ours(dir: &Path) -> usize {
    let mut killed = 0;
    for (pid, path) in find_processes() {
        if !owns_process(path.as_deref(), dir) {
            continue;
        }
        let out = tokio::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x0800_0000)
            .output()
            .await;
        if matches!(out, Ok(o) if o.status.success()) {
            killed += 1;
        }
    }
    killed
}

pub async fn status() -> TgwsStatus {
    let exe = exe_path().ok();
    let dir = install_dir().unwrap_or_default();
    let procs = find_processes();
    let ours = procs
        .iter()
        .find(|(_, path)| owns_process(path.as_deref(), &dir));
    build_status(ours.is_some(), ours.map(|(pid, _)| *pid), exe)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub version: String,
    pub path: String,
    pub size: u64,
}

fn latest_asset_url() -> (String, String) {
    let fallback = ("v1.11.4".to_string(), RELEASE_URL.to_string());
    let Ok(release) = crate::services::github::latest(REPO) else {
        return fallback;
    };
    let tag = if release.tag.is_empty() {
        fallback.0
    } else {
        release.tag
    };
    let url = release
        .assets
        .iter()
        .find(|asset| asset.name.eq_ignore_ascii_case(EXE_NAME))
        .map(|asset| asset.url.clone())
        .unwrap_or(fallback.1);
    (tag, url)
}

pub fn install_blocking(
    on_progress: &dyn Fn(u64, u64),
    cancel: &tokio_util::sync::CancellationToken,
) -> Result<InstallResult, AppError> {
    let dir = install_dir()?;
    let target = dir.join(EXE_NAME);
    let (version, url) = latest_asset_url();
    if !url.starts_with("https://") {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Разрешены только https-ссылки",
        ));
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build();
    let resp = agent
        .get(&url)
        .set("User-Agent", "Control-App")
        .call()
        .map_err(|e| {
            let text = e.to_string();
            let lower = text.to_lowercase();
            let message = if lower.contains("timeout")
                || lower.contains("timed out")
                || lower.contains("10060")
            {
                "GitHub не отвечает. Включите защиту zapret или VPN и повторите"
            } else {
                "Не удалось скачать TG WS Proxy"
            };
            AppError::new("NETWORK_ERROR", message)
                .with_details(serde_json::json!({ "error": text, "url": url }))
        })?;
    let total = resp
        .header("Content-Length")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    let part = dir.join(format!("{EXE_NAME}.part-{}", uuid::Uuid::new_v4().simple()));
    use std::io::{Read, Write};
    let mut reader = resp.into_reader();
    let mut file = std::io::BufWriter::new(std::fs::File::create(&part).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось создать файл загрузки")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?);
    let mut downloaded = 0u64;
    let mut buf = [0u8; 65536];
    loop {
        if cancel.is_cancelled() {
            drop(file);
            let _ = std::fs::remove_file(&part);
            return Err(AppError::new("CANCELLED", "Загрузка отменена"));
        }
        let n = reader.read(&mut buf).map_err(|e| {
            let _ = std::fs::remove_file(&part);
            AppError::new("NETWORK_ERROR", "Соединение прервано при загрузке")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| {
            let _ = std::fs::remove_file(&part);
            AppError::new("IO_ERROR", "Ошибка записи при загрузке")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
        downloaded += n as u64;
        if total > 0 {
            on_progress(downloaded, total);
        }
    }
    file.flush().ok();
    drop(file);
    if total > 0 && downloaded != total {
        let _ = std::fs::remove_file(&part);
        return Err(AppError::new(
            "DOWNLOAD_INCOMPLETE",
            format!("Загружено {downloaded} из {total} байт"),
        ));
    }
    let mut magic = [0u8; 2];
    let magic_ok = std::fs::File::open(&part)
        .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut magic))
        .is_ok()
        && magic == *b"MZ";
    if !magic_ok {
        let _ = std::fs::remove_file(&part);
        return Err(AppError::new(
            "INVALID_DOWNLOAD",
            "GitHub вернул не исполняемый файл. Повторите загрузку позже",
        ));
    }

    let _ = std::fs::remove_file(&target);
    std::fs::rename(&part, &target).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        AppError::new("IO_ERROR", "Не удалось сохранить TG WS Proxy")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok(InstallResult {
        version,
        path: target.to_string_lossy().into_owned(),
        size: downloaded,
    })
}

pub fn autostart_enabled() -> bool {
    crate::storage::settings::read_settings_raw()
        .ok()
        .and_then(|s| s.get("tgwsAutostart").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

pub fn autostart_ready() -> bool {
    autostart_enabled() && exe_path().map(|p| p.is_file()).unwrap_or(false)
}

pub async fn start() -> Result<TgwsStatus, AppError> {
    let _guard = start_lock().lock().await;
    let dir = install_dir()?;
    let exe = dir.join(EXE_NAME);
    if !exe.is_file() {
        return Err(AppError::new(
            "TGWS_NOT_INSTALLED",
            "TG WS Proxy не установлен. Скачайте его на вкладке TG Proxy",
        ));
    }
    let running: Vec<u32> = find_processes()
        .into_iter()
        .filter(|(_, path)| owns_process(path.as_deref(), &dir))
        .map(|(pid, _)| pid)
        .collect();
    if running.len() > 1 {
        tracing::warn!(
            count = running.len(),
            "найдено несколько TG WS Proxy, перезапускаю один"
        );
        let _ = kill_ours(&dir).await;
        tokio::time::sleep(Duration::from_millis(400)).await;
    } else if running.len() == 1 {
        return Ok(status().await);
    }
    std::process::Command::new(&exe)
        .current_dir(&dir)
        .creation_flags(0x0800_0000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            AppError::new("PROCESS_SPAWN_FAILED", "Не удалось запустить TG WS Proxy")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;

    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        let st = status().await;
        if st.running && st.config_exists {
            return Ok(st);
        }
    }
    let st = status().await;
    if st.running {
        Ok(st)
    } else {
        Err(AppError::new(
            "TGWS_NOT_STARTED",
            "TG WS Proxy не появился в списке процессов. Проверьте антивирус",
        ))
    }
}

pub async fn stop() -> Result<TgwsStatus, AppError> {
    let dir = install_dir()?;
    if kill_ours(&dir).await > 0 {
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    Ok(status().await)
}

pub async fn uninstall() -> Result<TgwsStatus, AppError> {
    let _ = stop().await;
    let exe = exe_path()?;
    if exe.is_file() {
        std::fs::remove_file(&exe).map_err(|e| {
            AppError::new("IO_ERROR", "Не удалось удалить TG WS Proxy")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    }
    Ok(status().await)
}

pub async fn set_port(port: u16) -> Result<TgwsStatus, AppError> {
    if port < 1024 {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Порт должен быть в диапазоне 1024–65535",
        ));
    }
    let mut cfg = read_config().unwrap_or_else(|| serde_json::json!({}));
    if !cfg.is_object() {
        cfg = serde_json::json!({});
    }
    cfg["port"] = serde_json::json!(port);
    write_config(&cfg)?;
    let was_running = status().await.running;
    if was_running {
        let _ = stop().await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        start().await?;
    }
    Ok(status().await)
}

pub fn open_telegram() -> Result<(), AppError> {
    let st = build_status(false, None, exe_path().ok());
    let link = st.link.ok_or_else(|| {
        AppError::new(
            "TGWS_NO_SECRET",
            "Секрет прокси ещё не создан. Запустите TG WS Proxy и повторите",
        )
    })?;
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &link])
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|e| {
            AppError::new("OPEN_FAILED", "Не удалось открыть Telegram")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    Ok(())
}

pub fn logs(max_lines: usize) -> Result<Vec<String>, AppError> {
    let path = log_path()?;
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return Ok(Vec::new()),
    };
    let mut lines: Vec<&str> = text.lines().rev().take(max_lines).collect();
    lines.reverse();
    Ok(lines.into_iter().map(str::to_string).collect())
}

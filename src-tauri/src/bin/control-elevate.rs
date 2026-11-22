use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use windows::Win32::System::Services::{
    ChangeServiceConfig2W, ChangeServiceConfigW, CloseServiceHandle, ControlService,
    CreateServiceW, DeleteService, OpenSCManagerW, OpenServiceW, QueryServiceStatusEx,
    StartServiceW, ENUM_SERVICE_TYPE, SC_HANDLE, SC_MANAGER_CONNECT, SC_MANAGER_CREATE_SERVICE,
    SC_STATUS_PROCESS_INFO, SERVICE_ALL_ACCESS, SERVICE_AUTO_START, SERVICE_CONFIG_DESCRIPTION,
    SERVICE_CONTROL_STOP, SERVICE_DEMAND_START, SERVICE_DESCRIPTIONW, SERVICE_DISABLED,
    SERVICE_ERROR, SERVICE_ERROR_NORMAL, SERVICE_KERNEL_DRIVER, SERVICE_NO_CHANGE,
    SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_START, SERVICE_START_PENDING,
    SERVICE_START_TYPE, SERVICE_STATUS, SERVICE_STATUS_PROCESS, SERVICE_STOP, SERVICE_STOPPED,
    SERVICE_STOP_PENDING, SERVICE_WIN32_OWN_PROCESS, SERVICE_WIN32_SHARE_PROCESS,
};

#[cfg(windows)]
use windows::core::PCWSTR;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const START_TIMEOUT: Duration = Duration::from_secs(20);
const STOP_TIMEOUT: Duration = Duration::from_secs(12);

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let report_path = args.get(1).cloned();
    let outcome = std::panic::catch_unwind(|| run(&args));
    match outcome {
        Ok(exit) => std::process::exit(exit),
        Err(_) => {
            if let Some(path) = report_path {
                write_report(
                    Path::new(&path),
                    &json!({ "ok": false, "error": "HELPER_PANIC", "steps": [] }),
                );
            }
            std::process::exit(4);
        }
    }
}

fn run(args: &[String]) -> i32 {
    if args.len() != 2 {
        eprintln!("usage: control-elevate <plan.json> <report.json>");
        return 2;
    }
    let plan_path = Path::new(&args[0]);
    let report_path = Path::new(&args[1]);

    let mut report = json!({ "ok": false, "error": null, "steps": [] });

    if !is_admin_process() {
        report["error"] = json!("NOT_ADMIN");
        write_report(report_path, &report);
        return 5;
    }

    let plan: Value = match std::fs::read(plan_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
    {
        Some(p) => p,
        None => {
            report["error"] = json!("BAD_PLAN");
            write_report(report_path, &report);
            return 3;
        }
    };

    if plan["plan_version"].as_u64() != Some(1) {
        report["error"] = json!("UNSUPPORTED_PLAN_VERSION");
        write_report(report_path, &report);
        return 3;
    }

    let mut failed = false;
    if let Some(steps) = plan["steps"].as_array() {
        for step in steps {
            let ignored = step["ignore_failure"].as_bool().unwrap_or(false);
            let mut step_report = execute_step(step);
            let ok = step_report["ok"].as_bool().unwrap_or(false);
            step_report["ignored"] = json!(ignored && !ok);
            if !ok && !ignored {
                failed = true;
            }
            report["steps"].as_array_mut().unwrap().push(step_report);
        }
    }
    report["ok"] = json!(!failed);
    if failed && report["error"].is_null() {
        report["error"] = json!("STEP_FAILED");
    }
    write_report(report_path, &report);
    if !failed {
        0
    } else {
        1
    }
}

fn is_admin_process() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::IsUserAnAdmin;
        unsafe { IsUserAnAdmin().as_bool() }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[derive(Debug)]
struct StepFailure {
    exit_code: Option<i32>,
    reason: String,
    detail: String,
}

impl StepFailure {
    fn new(reason: impl Into<String>, exit_code: Option<i32>, detail: impl Into<String>) -> Self {
        Self {
            exit_code,
            reason: reason.into(),
            detail: detail.into(),
        }
    }
}

fn execute_step(step: &Value) -> Value {
    let action = step["action"].as_str().unwrap_or_default();
    let result: Result<(Option<i32>, String), StepFailure> = match action {
        "copy_if_absent" => copy_if_absent(step),
        "service_upsert" | "service_create" => service_upsert(step),
        "service_start" => service_start(step),
        "service_stop" => service_stop(step),
        "service_delete" => service_delete(step),
        "reg_set" => reg_set(step),
        "legacy_autostart_cleanup" => legacy_cleanup(),
        _ => Err(StepFailure::new("UNKNOWN_ACTION", None, "unknown action")),
    };
    match result {
        Ok((code, tail)) => json!({
            "action": action,
            "ok": true,
            "exit_code": code,
            "output_tail": tail,
        }),
        Err(failure) => json!({
            "action": action,
            "ok": false,
            "exit_code": failure.exit_code,
            "output_tail": failure.detail,
            "reason": failure.reason,
        }),
    }
}

fn name(step: &Value) -> String {
    step["name"].as_str().unwrap_or_default().to_string()
}

fn copy_if_absent(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
    let from = step["from"]
        .as_str()
        .ok_or_else(|| StepFailure::new("BAD_PARAMS", None, "from missing"))?;
    let to = step["to"]
        .as_str()
        .ok_or_else(|| StepFailure::new("BAD_PARAMS", None, "to missing"))?;
    if !Path::new(from).is_file() {
        return Err(StepFailure::new(
            "SOURCE_MISSING",
            None,
            format!("{from} not found"),
        ));
    }
    let target_ok = std::fs::metadata(to)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false);
    if target_ok {
        return Ok((Some(0), "already present".into()));
    }
    std::fs::copy(from, to)
        .map(|_| (Some(0), "copied".into()))
        .map_err(|e| StepFailure::new("COPY_FAILED", None, format!("{from} -> {to}: {e}")))
}

fn reg_set(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
    let key = step["key"]
        .as_str()
        .ok_or_else(|| StepFailure::new("BAD_PARAMS", None, "key missing"))?;
    let value_name = step["value_name"]
        .as_str()
        .ok_or_else(|| StepFailure::new("BAD_PARAMS", None, "value_name missing"))?;
    let data = step["data"]
        .as_str()
        .ok_or_else(|| StepFailure::new("BAD_PARAMS", None, "data missing"))?;
    let value_type = step["value_type"].as_str().unwrap_or("REG_SZ");
    let mut cmd = Command::new("reg");
    cmd.args([
        "add", key, "/v", value_name, "/t", value_type, "/d", data, "/f",
    ])
    .creation_flags(CREATE_NO_WINDOW);
    match run_command(&mut cmd) {
        Ok((0, tail)) => Ok((Some(0), tail)),
        Ok((code, tail)) => Err(StepFailure::new("REG_SET_FAILED", Some(code), tail)),
        Err(e) => Err(StepFailure::new("SPAWN_FAILED", None, e)),
    }
}

fn legacy_cleanup() -> Result<(Option<i32>, String), StepFailure> {
    let _ = Command::new("schtasks")
        .args(["/Delete", "/TN", "Control-Zapret", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .status();
    let app_data = std::env::var("APPDATA").unwrap_or_default();
    control_app_dir(&app_data, |dir| {
        for name in ["autostart_zapret.vbs", "autostart_zapret.bat"] {
            let _ = std::fs::remove_file(dir.join(name));
        }
    });
    Ok((Some(0), "legacy cleaned".into()))
}

fn control_app_dir(app_data: &str, f: impl Fn(&Path)) {
    if app_data.is_empty() {
        return;
    }
    let dir = Path::new(app_data).join("control");
    f(&dir);
}

fn run_command(cmd: &mut Command) -> Result<(i32, String), String> {
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    match cmd.output() {
        Ok(output) => {
            let code = output.status.code().unwrap_or(-1);
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let combined = match (stderr.is_empty(), stdout.is_empty()) {
                (false, false) => format!("{stderr} {stdout}"),
                (false, true) => stderr,
                (true, false) => stdout,
                (true, true) => String::new(),
            };
            Ok((code, tail(&combined, 400)))
        }
        Err(e) => Err(e.to_string()),
    }
}

fn tail(text: &str, limit: usize) -> String {
    let count = text.chars().count();
    if count <= limit {
        return text.to_string();
    }
    text.chars().skip(count - limit).collect()
}

#[cfg(windows)]
mod win_service {
    use super::*;

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn error_code(error: &windows::core::Error) -> i32 {
        let code = error.code().0 as u32;
        if code & 0xFFFF_0000 == 0x8007_0000 {
            (code & 0xFFFF) as i32
        } else {
            code as i32
        }
    }

    pub fn error_text(code: i32) -> String {
        std::io::Error::from_raw_os_error(code).to_string()
    }

    fn failure(reason: &str, error: &windows::core::Error) -> StepFailure {
        let code = error_code(error);
        StepFailure::new(reason, Some(code), format!("{code}: {}", error_text(code)))
    }

    struct Scm(SC_HANDLE);

    impl Scm {
        fn open(access: u32) -> Result<Self, StepFailure> {
            unsafe {
                OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), access)
                    .map(Self)
                    .map_err(|e| failure("SCM_OPEN_FAILED", &e))
            }
        }

        fn service(&self, name: &str, access: u32) -> Result<ScHandle, windows::core::Error> {
            let name = wide(name);
            unsafe { OpenServiceW(self.0, PCWSTR::from_raw(name.as_ptr()), access).map(ScHandle) }
        }
    }

    impl Drop for Scm {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseServiceHandle(self.0);
            }
        }
    }

    struct ScHandle(SC_HANDLE);

    impl Drop for ScHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseServiceHandle(self.0);
            }
        }
    }

    fn start_type(raw: Option<&str>) -> SERVICE_START_TYPE {
        match raw.unwrap_or("demand").to_ascii_lowercase().as_str() {
            "auto" | "automatic" => SERVICE_AUTO_START,
            "disabled" => SERVICE_DISABLED,
            _ => SERVICE_DEMAND_START,
        }
    }

    fn service_type(raw: Option<&str>) -> ENUM_SERVICE_TYPE {
        match raw.unwrap_or("win32").to_ascii_lowercase().as_str() {
            "kernel" | "driver" => SERVICE_KERNEL_DRIVER,
            "share" | "share_process" => SERVICE_WIN32_SHARE_PROCESS,
            _ => SERVICE_WIN32_OWN_PROCESS,
        }
    }

    fn set_description(handle: SC_HANDLE, description: &str) -> Result<(), windows::core::Error> {
        let mut buffer = wide(description);
        let info = SERVICE_DESCRIPTIONW {
            lpDescription: windows::core::PWSTR::from_raw(buffer.as_mut_ptr()),
        };
        unsafe {
            ChangeServiceConfig2W(
                handle,
                SERVICE_CONFIG_DESCRIPTION,
                Some(&info as *const _ as *const core::ffi::c_void),
            )
        }
    }

    pub fn upsert(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
        let svc_name = name(step);
        if svc_name.is_empty() {
            return Err(StepFailure::new("BAD_PARAMS", None, "service name missing"));
        }
        let bin_path = step["bin_path"]
            .as_str()
            .ok_or_else(|| StepFailure::new("BAD_PARAMS", None, "bin_path missing"))?;
        let display = step["display_name"].as_str().unwrap_or(&svc_name);
        let description = step["description"].as_str();
        let start_only = step["start_if_absent_only"].as_bool().unwrap_or(false);
        let svc_name_w = wide(&svc_name);
        let display_w = wide(display);
        let bin_path_w = wide(bin_path);
        let type_ = service_type(step["service_type"].as_str());
        let start_ = start_type(step["start"].as_str());

        let scm = Scm::open(SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE)?;

        match scm.service(&svc_name, SERVICE_ALL_ACCESS) {
            Ok(existing) => {
                if start_only {
                    return Ok((Some(0), "service already exists".into()));
                }
                unsafe {
                    ChangeServiceConfigW(
                        existing.0,
                        type_,
                        start_,
                        SERVICE_ERROR(SERVICE_NO_CHANGE),
                        PCWSTR::from_raw(bin_path_w.as_ptr()),
                        PCWSTR::null(),
                        None,
                        PCWSTR::null(),
                        PCWSTR::null(),
                        PCWSTR::null(),
                        PCWSTR::from_raw(display_w.as_ptr()),
                    )
                    .map_err(|e| failure("SERVICE_UPDATE_FAILED", &e))?;
                }
                if let Some(description) = description {
                    set_description(existing.0, description)
                        .map_err(|e| failure("SERVICE_DESCRIPTION_FAILED", &e))?;
                }
                Ok((Some(0), "service updated".into()))
            }
            Err(error) if error_code(&error) == 1060 => {
                let handle = unsafe {
                    CreateServiceW(
                        scm.0,
                        PCWSTR::from_raw(svc_name_w.as_ptr()),
                        PCWSTR::from_raw(display_w.as_ptr()),
                        SERVICE_ALL_ACCESS,
                        type_,
                        start_,
                        SERVICE_ERROR_NORMAL,
                        PCWSTR::from_raw(bin_path_w.as_ptr()),
                        PCWSTR::null(),
                        None,
                        PCWSTR::null(),
                        PCWSTR::null(),
                        PCWSTR::null(),
                    )
                };
                let handle = match handle {
                    Ok(handle) => ScHandle(handle),
                    Err(error) if error_code(&error) == 1073 => {
                        return Ok((Some(0), "service appeared".into()))
                    }
                    Err(error) => return Err(failure("SERVICE_CREATE_FAILED", &error)),
                };
                if let Some(description) = description {
                    set_description(handle.0, description)
                        .map_err(|e| failure("SERVICE_DESCRIPTION_FAILED", &e))?;
                }
                Ok((Some(0), "service created".into()))
            }
            Err(error) if error_code(&error) == 1072 => Err(StepFailure::new(
                "SERVICE_PENDING_DELETE",
                Some(1072),
                "служба помечена на удаление после прошлой попытки",
            )),
            Err(error) => Err(failure("SERVICE_OPEN_FAILED", &error)),
        }
    }

    fn read_status(handle: SC_HANDLE) -> Result<SERVICE_STATUS_PROCESS, StepFailure> {
        let mut status = SERVICE_STATUS_PROCESS::default();
        let mut needed = 0u32;
        unsafe {
            QueryServiceStatusEx(
                handle,
                SC_STATUS_PROCESS_INFO,
                Some(std::slice::from_raw_parts_mut(
                    &mut status as *mut _ as *mut u8,
                    std::mem::size_of::<SERVICE_STATUS_PROCESS>(),
                )),
                &mut needed,
            )
            .map_err(|e| failure("SERVICE_QUERY_FAILED", &e))?;
        }
        Ok(status)
    }

    pub fn start(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
        let svc_name = name(step);
        let waited = step["wait_ms"]
            .as_u64()
            .map(Duration::from_millis)
            .unwrap_or(START_TIMEOUT);
        let scm = Scm::open(SC_MANAGER_CONNECT)?;
        let service = match scm.service(&svc_name, SERVICE_START | SERVICE_QUERY_STATUS) {
            Ok(service) => service,
            Err(error) if error_code(&error) == 1060 => {
                return Err(StepFailure::new(
                    "SERVICE_NOT_FOUND",
                    Some(1060),
                    "служба не найдена: создание не выполнилось",
                ))
            }
            Err(error) if error_code(&error) == 1072 => {
                return Err(StepFailure::new(
                    "SERVICE_PENDING_DELETE",
                    Some(1072),
                    "служба помечена на удаление",
                ))
            }
            Err(error) => return Err(failure("SERVICE_OPEN_FAILED", &error)),
        };

        if let Err(error) = unsafe { StartServiceW(service.0, None) } {
            let code = error_code(&error);
            if code != 1056 {
                return Err(failure("SERVICE_START_FAILED", &error));
            }
        }

        let deadline = Instant::now() + waited;
        loop {
            let status = read_status(service.0)?;
            match status.dwCurrentState {
                SERVICE_RUNNING => {
                    return Ok((Some(0), format!("running, pid {}", status.dwProcessId)))
                }
                SERVICE_STOPPED => {
                    let code = status.dwWin32ExitCode;
                    let text = if code == 0 {
                        "процесс службы завершился сразу после запуска".to_string()
                    } else {
                        format!(
                            "процесс службы завершился: {code}: {}",
                            error_text(code as i32)
                        )
                    };
                    return Err(StepFailure::new("SERVICE_EXITED", Some(code as i32), text));
                }
                _ => {}
            }
            if Instant::now() >= deadline {
                return Err(StepFailure::new(
                    "SERVICE_START_TIMEOUT",
                    Some(1053),
                    "служба не перешла в состояние «работает» за отведённое время",
                ));
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    pub fn stop(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
        let svc_name = name(step);
        let scm = Scm::open(SC_MANAGER_CONNECT)?;
        let service = match scm.service(&svc_name, SERVICE_STOP | SERVICE_QUERY_STATUS) {
            Ok(service) => service,
            Err(error) if matches!(error_code(&error), 1060 | 1072) => {
                return Ok((Some(0), "service absent".into()))
            }
            Err(error) => return Err(failure("SERVICE_OPEN_FAILED", &error)),
        };
        let mut status = SERVICE_STATUS::default();
        if let Err(error) = unsafe { ControlService(service.0, SERVICE_CONTROL_STOP, &mut status) }
        {
            let code = error_code(&error);
            if code == 1062 {
                return Ok((Some(0), "already stopped".into()));
            }
            return Err(failure("SERVICE_STOP_FAILED", &error));
        }
        let deadline = Instant::now() + STOP_TIMEOUT;
        loop {
            let status = read_status(service.0)?;
            match status.dwCurrentState {
                SERVICE_STOPPED => return Ok((Some(0), "stopped".into())),
                SERVICE_STOP_PENDING | SERVICE_START_PENDING => {}
                _ => return Ok((Some(0), "stop requested".into())),
            }
            if Instant::now() >= deadline {
                return Err(StepFailure::new(
                    "SERVICE_STOP_TIMEOUT",
                    Some(1053),
                    "служба не остановилась за отведённое время",
                ));
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    pub fn delete(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
        let svc_name = name(step);
        let scm = Scm::open(SC_MANAGER_CONNECT)?;
        let service = match scm.service(&svc_name, 0x0001_0000) {
            Ok(service) => service,
            Err(error) if matches!(error_code(&error), 1060 | 1072) => {
                return Ok((Some(0), "service absent".into()))
            }
            Err(error) => return Err(failure("SERVICE_OPEN_FAILED", &error)),
        };
        unsafe { DeleteService(service.0) }
            .map(|_| (Some(0), "deleted".into()))
            .map_err(|e| failure("SERVICE_DELETE_FAILED", &e))
    }
}

#[cfg(windows)]
fn service_upsert(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
    win_service::upsert(step)
}

#[cfg(windows)]
fn service_start(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
    win_service::start(step)
}

#[cfg(windows)]
fn service_stop(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
    win_service::stop(step)
}

#[cfg(windows)]
fn service_delete(step: &Value) -> Result<(Option<i32>, String), StepFailure> {
    win_service::delete(step)
}

#[cfg(not(windows))]
fn service_upsert(_: &Value) -> Result<(Option<i32>, String), StepFailure> {
    Err(StepFailure::new("UNSUPPORTED", None, "windows only"))
}

#[cfg(not(windows))]
fn service_start(_: &Value) -> Result<(Option<i32>, String), StepFailure> {
    Err(StepFailure::new("UNSUPPORTED", None, "windows only"))
}

#[cfg(not(windows))]
fn service_stop(_: &Value) -> Result<(Option<i32>, String), StepFailure> {
    Err(StepFailure::new("UNSUPPORTED", None, "windows only"))
}

#[cfg(not(windows))]
fn service_delete(_: &Value) -> Result<(Option<i32>, String), StepFailure> {
    Err(StepFailure::new("UNSUPPORTED", None, "windows only"))
}

fn write_report(path: &Path, report: &Value) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("report.tmp");
    if let Ok(mut file) = std::fs::File::create(&tmp) {
        let written = serde_json::to_writer_pretty(&mut file, report).is_ok();
        let flushed = file.flush().is_ok();
        drop(file);
        if written && flushed && std::fs::rename(&tmp, path).is_ok() {
            return;
        }
        let _ = std::fs::remove_file(&tmp);
    }
    if let Ok(mut file) = std::fs::File::create(path) {
        let _ = serde_json::to_writer_pretty(&mut file, report);
        let _ = file.flush();
    }
}

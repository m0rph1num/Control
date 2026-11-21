use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
            let step_report = execute_step(step);
            if !step_report["ok"].as_bool().unwrap_or(false)
                && !step["ignore_failure"].as_bool().unwrap_or(false)
            {
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

fn execute_step(step: &Value) -> Value {
    let action = step["action"].as_str().unwrap_or_default();
    let result = match action {
        "copy_if_absent" => copy_if_absent(step),
        "service_create" => sc_create(step),
        "service_start" => run_simple("sc", &["start", &name(step)]),
        "service_stop" => run_simple("sc", &["stop", &name(step)]),
        "service_delete" => run_simple("sc", &["delete", &name(step)]),
        "reg_set" => reg_set(step),
        "legacy_autostart_cleanup" => legacy_cleanup(),
        _ => Err(("UNKNOWN_ACTION".into(), "unknown action".into())),
    };
    match result {
        Ok((code, tail)) => json!({
            "action": action,
            "ok": is_benign(action, code),
            "exitCode": code,
            "outputTail": tail,
        }),
        Err((reason, tail)) => json!({
            "action": action, "ok": false, "exitCode": null,
            "outputTail": tail, "reason": reason,
        }),
    }
}

fn is_benign(action: &str, code: i32) -> bool {
    if code == 0 {
        return true;
    }
    match action {
        "service_start" => code == 1056,
        "service_stop" => matches!(code, 1060 | 1062),
        "service_delete" => matches!(code, 1060 | 1072),
        "service_create" => code == 1073,
        _ => false,
    }
}

fn name(step: &Value) -> String {
    step["name"].as_str().unwrap_or_default().to_string()
}

fn copy_if_absent(step: &Value) -> Result<(i32, String), (String, String)> {
    let from = step["from"]
        .as_str()
        .ok_or(("BAD_PARAMS".to_string(), "from missing".to_string()))?;
    let to = step["to"]
        .as_str()
        .ok_or(("BAD_PARAMS".to_string(), "to missing".to_string()))?;
    if Path::new(from).is_file() {
        let target_ok = std::fs::metadata(to)
            .map(|m| m.is_file() && m.len() > 0)
            .unwrap_or(false);
        if target_ok {
            return Ok((0, "already present".into()));
        }
    } else {
        return Err(("SOURCE_MISSING".into(), format!("{from} not found")));
    }
    std::fs::copy(from, to)
        .map(|_| (0, "copied".into()))
        .map_err(|e| ("COPY_FAILED".into(), format!("{from} -> {to}: {e}")))
}

fn service_exists(svc_name: &str) -> bool {
    let mut cmd = Command::new("sc");
    cmd.args(["query", svc_name])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    matches!(cmd.status(), Ok(status) if status.code() == Some(0))
}

fn sc_create(step: &Value) -> Result<(i32, String), (String, String)> {
    let svc_name = name(step);
    if svc_name.is_empty() {
        return Err(("BAD_PARAMS".into(), "service name missing".into()));
    }
    if step["start_if_absent_only"].as_bool().unwrap_or(false) && service_exists(&svc_name) {
        return Ok((0, "service already exists".into()));
    }

    let mut last: Result<(i32, String), (String, String)> = Err((
        "SERVICE_NOT_CREATED".into(),
        "service create did not run".into(),
    ));
    for attempt in 0..4 {
        last = create_service(step);
        match &last {
            Ok((1075, _)) => {
                std::thread::sleep(std::time::Duration::from_millis(650 * (attempt + 1)));
            }
            _ => return last,
        }
    }
    last
}

fn create_service(step: &Value) -> Result<(i32, String), (String, String)> {
    let svc_name = name(step);
    let bin_path = step["bin_path"]
        .as_str()
        .ok_or(("BAD_PARAMS".to_string(), "bin_path missing".to_string()))?;
    let mut cmd = Command::new("sc");
    cmd.arg("create").arg(&svc_name);

    cmd.raw_arg(format!("binPath= {bin_path}"));
    if let Some(display) = step["display_name"].as_str() {
        cmd.raw_arg(format!("DisplayName= \"{display}\""));
    }
    if let Some(description) = step["description"].as_str() {
        cmd.raw_arg(format!("description= \"{description}\""));
    }
    if let Some(t) = step["service_type"].as_str() {
        cmd.raw_arg(format!("type= {t}"));
    }
    if let Some(start) = step["start"].as_str() {
        cmd.raw_arg(format!("start= {start}"));
    }
    cmd.creation_flags(CREATE_NO_WINDOW);
    run_command(&mut cmd)
}

fn reg_set(step: &Value) -> Result<(i32, String), (String, String)> {
    let key = step["key"]
        .as_str()
        .ok_or(("BAD_PARAMS".to_string(), "key missing".to_string()))?;
    let value_name = step["value_name"]
        .as_str()
        .ok_or(("BAD_PARAMS".to_string(), "value_name missing".to_string()))?;
    let data = step["data"]
        .as_str()
        .ok_or(("BAD_PARAMS".to_string(), "data missing".to_string()))?;
    let mut cmd = Command::new("reg");
    cmd.args(["add", key, "/v", value_name]);
    cmd.raw_arg(format!(
        "/t {}",
        step["value_type"].as_str().unwrap_or("REG_SZ")
    ));
    cmd.raw_arg(format!("/d \"{data}\""));
    cmd.arg("/f");
    cmd.creation_flags(CREATE_NO_WINDOW);
    run_command(&mut cmd)
}

fn legacy_cleanup() -> Result<(i32, String), (String, String)> {
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
    Ok((0, "legacy cleaned".into()))
}

fn control_app_dir(app_data: &str, f: impl Fn(&Path)) {
    if app_data.is_empty() {
        return;
    }
    let dir = Path::new(app_data).join("control");
    f(&dir);
}

fn run_simple(program: &str, args: &[&str]) -> Result<(i32, String), (String, String)> {
    let mut cmd = Command::new(program);
    cmd.args(args).creation_flags(CREATE_NO_WINDOW);
    run_command(&mut cmd)
}

fn run_command(cmd: &mut Command) -> Result<(i32, String), (String, String)> {
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
            let tail = combined.chars().rev().take(400).collect::<String>();
            let tail = tail.chars().rev().collect::<String>();
            Ok((code, tail))
        }
        Err(e) => Err(("SPAWN_FAILED".into(), e.to_string())),
    }
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

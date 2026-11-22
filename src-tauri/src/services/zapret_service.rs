use crate::domain::strategy::parse_strategy_args;
use crate::errors::AppError;
use crate::services::elevation::{ElevationPlan, ElevationStep};
use crate::storage::settings;
use std::path::{Path, PathBuf};

pub const ZAPRET_SERVICE_NAME: &str = "zapret";
pub const WINDIVERT_SERVICE_NAME: &str = "WinDivert";

struct ServiceArgs {
    bin_path: PathBuf,
    args: String,
    strategy_filename: String,
}

fn build_service_args_for(dir: &Path, strategy_value: &str) -> Result<ServiceArgs, AppError> {
    let (content, strategy_filename) = load_strategy(dir, strategy_value)?;
    let game_mode = settings::game_filter_mode(dir);
    let parsed = parse_strategy_args(&content, dir, game_mode);
    if !parsed.bin_path.is_file() {
        return Err(AppError::new(
            "WINWS_MISSING",
            "winws.exe не найден в установленной версии",
        ));
    }
    Ok(ServiceArgs {
        bin_path: parsed.bin_path,
        args: parsed.args.join(" "),
        strategy_filename,
    })
}

fn load_strategy(dir: &Path, strategy_value: &str) -> Result<(String, String), AppError> {
    if let Some(name) = strategy_value.strip_prefix("preset:") {
        let preset = crate::services::presets::read(name)?;
        return Ok((preset.content, format!("preset:{name}")));
    }
    let strategies = settings::list_strategies(dir);
    let strategy = strategies
        .iter()
        .find(|s| s.value == strategy_value)
        .or_else(|| strategies.first())
        .ok_or_else(|| {
            AppError::new(
                "NO_STRATEGIES",
                "Не найдено ни одной стратегии для автозапуска",
            )
        })?;
    let content = std::fs::read_to_string(&strategy.path).map_err(|e| {
        AppError::new("IO_ERROR", "Не удалось прочитать стратегию")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    Ok((content, strategy.filename.clone()))
}

pub fn service_install_plan(dir: &Path) -> Result<ElevationPlan, AppError> {
    let strategy_value = settings::read_settings_raw()
        .ok()
        .and_then(|raw| settings::settings_str(&raw, "lastStrategy").map(str::to_string))
        .filter(|value| !value.is_empty())
        .or_else(|| {
            settings::read_flowseal_config()
                .ok()
                .filter(|v| v.is_object())
                .and_then(|cfg| {
                    cfg.get("strategy")
                        .and_then(|s| s.as_str())
                        .map(str::to_string)
                })
        })
        .unwrap_or_default();
    service_install_plan_for(dir, &strategy_value)
}

pub fn service_install_plan_for(
    dir: &Path,
    strategy_value: &str,
) -> Result<ElevationPlan, AppError> {
    let service = build_service_args_for(dir, strategy_value)?;

    let bin_path_arg = format!(
        "\"{}\" {}",
        service.bin_path.to_string_lossy(),
        service.args
    );
    let reg_key = format!("HKLM\\System\\CurrentControlSet\\Services\\{ZAPRET_SERVICE_NAME}");

    let mut steps = Vec::new();

    let bin_dir = dir.join("bin");
    let sys_files: Vec<String> = std::fs::read_dir(&bin_dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|f| f.to_lowercase().ends_with(".sys"))
                .collect()
        })
        .unwrap_or_default();
    let is64 = std::env::var("PROCESSOR_ARCHITECTURE")
        .map(|a| a == "AMD64")
        .unwrap_or(cfg!(target_arch = "x86_64"));
    let driver_file = sys_files.iter().find(|f| {
        let l = f.to_lowercase();
        if is64 {
            l.contains("win64") || l.contains("windivert64")
        } else {
            l.contains("win32") || l.contains("windivert32")
        }
    });
    if let Some(driver) = driver_file.or_else(|| sys_files.first()) {
        let target_sys =
            PathBuf::from(std::env::var("SYSTEMROOT").unwrap_or_else(|_| "C:\\Windows".into()))
                .join("System32")
                .join("drivers")
                .join("WinDivert.sys");
        steps.push(ElevationStep {
            action: "copy_if_absent".into(),
            params: serde_json::json!({
                "from": bin_dir.join(driver).to_string_lossy(),
                "to": target_sys.to_string_lossy(),
            }),
        });
        steps.push(ElevationStep {
            action: "service_upsert".into(),
            params: serde_json::json!({
                "name": WINDIVERT_SERVICE_NAME,
                "bin_path": target_sys.to_string_lossy(),
                "service_type": "kernel",
                "start": "demand",
                "start_if_absent_only": true,
            }),
        });
        steps.push(ElevationStep {
            action: "service_start".into(),
            params: serde_json::json!({ "name": WINDIVERT_SERVICE_NAME, "ignore_failure": true }),
        });
    }

    steps.push(ElevationStep {
        action: "service_stop".into(),
        params: serde_json::json!({ "name": ZAPRET_SERVICE_NAME, "ignore_failure": true }),
    });
    steps.push(ElevationStep {
        action: "service_upsert".into(),
        params: serde_json::json!({
            "name": ZAPRET_SERVICE_NAME,
            "bin_path": bin_path_arg,
            "display_name": "zapret",
            "start": "auto",
            "description": "Zapret DPI bypass software",
        }),
    });
    steps.push(ElevationStep {
        action: "reg_set".into(),
        params: serde_json::json!({
            "key": reg_key,
            "value_name": "zapret-discord-youtube",
            "data": service.strategy_filename,
            "value_type": "reg_sz",
        }),
    });
    steps.push(ElevationStep {
        action: "service_start".into(),
        params: serde_json::json!({ "name": ZAPRET_SERVICE_NAME, "wait_ms": 20000 }),
    });

    Ok(ElevationPlan {
        plan_version: crate::services::elevation::PLAN_VERSION,
        description: "Установка службы автозапуска zapret".into(),
        steps,
    })
}

pub fn service_remove_plan() -> ElevationPlan {
    ElevationPlan {
        plan_version: crate::services::elevation::PLAN_VERSION,
        description: "Удаление службы автозапуска zapret".into(),
        steps: vec![
            ElevationStep {
                action: "service_stop".into(),
                params: serde_json::json!({ "name": ZAPRET_SERVICE_NAME, "ignore_failure": true }),
            },
            ElevationStep {
                action: "service_delete".into(),
                params: serde_json::json!({ "name": ZAPRET_SERVICE_NAME, "ignore_failure": true }),
            },
            ElevationStep {
                action: "legacy_autostart_cleanup".into(),
                params: serde_json::json!({}),
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct KeepTemp;
    impl KeepTemp {
        fn path(&self) -> PathBuf {
            let d = std::env::temp_dir().join(format!("control-svc-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(d.join("bin")).unwrap();
            d
        }
    }

    #[test]
    fn install_plan_contains_expected_steps() {
        let dir = KeepTemp.path();
        std::fs::write(dir.join("bin").join("winws.exe"), b"stub").unwrap();
        std::fs::write(dir.join("bin").join("WinDivert64.sys"), b"stub").unwrap();
        let bat = dir.join("general.bat");
        std::fs::write(
            &bat,
            "@echo off\r\nstart \"winws\" \"%~dp0bin\\winws.exe\" --wf-tcp=443 --wf-udp=443\r\n",
        )
        .unwrap();

        let plan = service_install_plan_for(&dir, "").unwrap();
        let actions: Vec<&str> = plan.steps.iter().map(|s| s.action.as_str()).collect();
        assert!(actions.contains(&"copy_if_absent"));
        assert!(actions.contains(&"service_upsert"));
        assert!(actions.contains(&"reg_set"));
        assert_eq!(plan.steps.last().unwrap().action, "service_start");

        let create = plan
            .steps
            .iter()
            .rev()
            .find(|s| s.action == "service_upsert")
            .unwrap();
        assert_eq!(create.params["name"], "zapret");
        assert!(create.params["bin_path"]
            .as_str()
            .unwrap()
            .contains("winws.exe"));
    }
}

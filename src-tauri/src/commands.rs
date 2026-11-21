use crate::errors::AppError;
use crate::services::zapret::ProtectionSnapshot;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupFlags {
    pub minimized: bool,
}

#[tauri::command]
pub fn startup_flags() -> StartupFlags {
    StartupFlags {
        minimized: crate::services::autostart::launched_minimized(),
    }
}

#[tauri::command]
pub fn app_info(state: State<'_, Arc<AppState>>) -> Result<AppInfo, AppError> {
    Ok(AppInfo {
        name: "Control".to_string(),
        version: state.version.clone(),
    })
}

#[tauri::command]
pub async fn operations_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::services::operations::OperationSnapshot>, AppError> {
    Ok(state.operations.list().await)
}

#[tauri::command]
pub async fn operations_cancel(
    state: State<'_, Arc<AppState>>,
    operation_id: String,
) -> Result<bool, AppError> {
    let id = Uuid::parse_str(&operation_id)
        .map_err(|_| AppError::new("INVALID_ARGUMENT", "Некорректный идентификатор операции"))?;
    Ok(state.operations.cancel(id).await)
}

#[tauri::command]
pub async fn protection_status(
    state: State<'_, Arc<AppState>>,
) -> Result<ProtectionSnapshot, AppError> {
    state.zapret.refresh().await
}

#[tauri::command]
pub async fn protection_snapshot(
    state: State<'_, Arc<AppState>>,
) -> Result<ProtectionSnapshot, AppError> {
    Ok(state.zapret.snapshot().await)
}

#[tauri::command]
pub async fn service_status(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::services::service_query::ServiceStatus, AppError> {
    state.zapret.service_status().get().await
}

#[tauri::command]
pub async fn windivert_status() -> Result<crate::services::service_query::ServiceStatus, AppError> {
    crate::services::zapret::windivert_status().await
}

#[tauri::command]
pub async fn protection_start(
    state: State<'_, Arc<AppState>>,
    strategy_value: String,
) -> Result<String, AppError> {
    let (strategy_path, dir, game_mode) = resolve_strategy(&state, &strategy_value).await?;

    persist_last_strategy(&state, &strategy_value).await;
    state.control.start(strategy_path, dir, game_mode).await
}

#[tauri::command]
pub async fn protection_apply(
    state: State<'_, Arc<AppState>>,
    strategy_value: String,
) -> Result<bool, AppError> {
    let (strategy_path, dir, game_mode) = resolve_strategy(&state, &strategy_value).await?;
    persist_last_strategy(&state, &strategy_value).await;
    state
        .control
        .reconfigure_with(strategy_path, dir, game_mode)
        .await
}

async fn resolve_strategy(
    state: &Arc<AppState>,
    strategy_value: &str,
) -> Result<
    (
        std::path::PathBuf,
        std::path::PathBuf,
        crate::domain::strategy::GameFilterMode,
    ),
    AppError,
> {
    if strategy_value.contains('\\')
        || strategy_value.contains('/')
        || strategy_value.contains("..")
        || strategy_value.contains('\0')
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Некорректное имя стратегии",
        ));
    }
    let settings = crate::storage::settings::read_settings_raw()?;
    let dir = crate::storage::settings::find_flowseal_dir(&settings).ok_or_else(|| {
        AppError::new(
            "NO_ZAPRET_INSTALL",
            "Установка Zapret не найдена. Установите или выберите версию",
        )
    })?;
    state.zapret.set_our_roots(vec![dir.clone()]).await;

    let strategy_path = match strategy_value.strip_prefix("preset:") {
        Some(preset_name) => {
            crate::services::presets::read(preset_name)?;
            crate::services::presets::presets_dir()?.join(format!("{preset_name}.bat"))
        }
        None => dir.join(format!("{strategy_value}.bat")),
    };
    if !strategy_path.is_file() {
        return Err(AppError::new(
            "STRATEGY_NOT_FOUND",
            "Файл стратегии не найден в выбранной версии",
        ));
    }
    let game_mode = crate::storage::settings::game_filter_mode(&dir);
    Ok((strategy_path, dir, game_mode))
}

async fn persist_last_strategy(state: &AppState, value: &str) {
    let Ok(snapshot) = crate::storage::settings::read_settings_recovering() else {
        return;
    };
    let mut content = snapshot.content.clone();
    if !content.is_object() {
        content = serde_json::json!({});
    }
    content["lastStrategy"] = serde_json::json!(value);
    if let Err(e) =
        crate::storage::settings::write_settings_checked(&state.locks, &snapshot, content).await
    {
        tracing::warn!(error = %e.user_message, "не удалось сохранить последнюю стратегию");
    }
}

#[tauri::command]
pub async fn protection_stop(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    state.control.stop().await
}

#[tauri::command]
pub async fn settings_get() -> Result<serde_json::Value, AppError> {
    let snapshot = crate::storage::settings::read_settings_recovering()?;
    Ok(snapshot.content)
}

#[tauri::command]
pub async fn settings_set(
    state: State<'_, Arc<AppState>>,
    value: serde_json::Value,
) -> Result<(), AppError> {
    let snapshot = crate::storage::settings::read_settings_recovering()?;

    crate::storage::settings::write_settings_checked(&state.locks, &snapshot, value).await
}

#[tauri::command]
pub async fn settings_update(
    state: State<'_, Arc<AppState>>,
    options: serde_json::Value,
) -> Result<(), AppError> {
    const ALLOWED: [&str; 5] = [
        "minimizeToTray",
        "notifications",
        "restoreState",
        "controlDir",
        "lastStrategy",
    ];
    let snapshot = crate::storage::settings::read_settings_recovering()?;
    let mut content = snapshot.content.clone();
    if !content.is_object() {
        content = serde_json::json!({});
    }
    for key in ALLOWED {
        if let Some(v) = options.get(key) {
            content[key] = v.clone();
        }
    }
    crate::storage::settings::write_settings_checked(&state.locks, &snapshot, content).await
}
#[tauri::command]
pub async fn flowseal_config_get() -> Result<serde_json::Value, AppError> {
    crate::storage::settings::read_flowseal_config()
}

#[tauri::command]
pub async fn flowseal_config_set(
    state: State<'_, Arc<AppState>>,
    value: serde_json::Value,
) -> Result<(), AppError> {
    crate::storage::settings::write_flowseal_config(&state.locks, &value).await
}

#[tauri::command]
pub async fn lists_get() -> Result<Vec<crate::services::filters::UserList>, AppError> {
    let dir = flowseal_dir()?;
    crate::services::filters::lists_get(&dir)
}

#[tauri::command]
pub async fn lists_write(
    state: State<'_, Arc<AppState>>,
    key: String,
    content: String,
) -> Result<(), AppError> {
    let dir = flowseal_dir()?;
    crate::services::filters::list_write(&dir, &key, &content)?;

    state.control.request_reconfigure();
    Ok(())
}

#[tauri::command]
pub async fn game_filter_get() -> Result<crate::domain::strategy::GameFilterMode, AppError> {
    let dir = flowseal_dir()?;
    Ok(crate::storage::settings::game_filter_mode(&dir))
}

#[tauri::command]
pub async fn game_filter_set(
    state: State<'_, Arc<AppState>>,
    mode: crate::domain::strategy::GameFilterMode,
) -> Result<(), AppError> {
    let dir = flowseal_dir()?;
    crate::services::filters::game_filter_set(&dir, mode)?;
    state.control.request_reconfigure();
    Ok(())
}

#[tauri::command]
pub async fn ipset_filter_get() -> Result<crate::services::filters::IpsetMode, AppError> {
    let dir = flowseal_dir()?;
    Ok(crate::services::filters::ipset_mode_get(&dir))
}

#[tauri::command]
pub async fn ipset_filter_set(
    state: State<'_, Arc<AppState>>,
    mode: crate::services::filters::IpsetMode,
) -> Result<(), AppError> {
    let dir = flowseal_dir()?;
    crate::services::filters::ipset_filter_set(&dir, mode)?;
    state.control.request_reconfigure();
    Ok(())
}

#[tauri::command]
pub async fn fakes_get() -> Result<crate::services::filters::FakesInfo, AppError> {
    let dir = flowseal_dir()?;
    Ok(crate::services::filters::fakes_get(&dir))
}

#[tauri::command]
pub async fn fakes_set(
    state: State<'_, Arc<AppState>>,
    fake_type: String,
    fake_name: String,
) -> Result<(), AppError> {
    let dir = flowseal_dir()?;
    crate::services::filters::fake_set(&dir, &fake_type, &fake_name)?;
    state.control.request_reconfigure();
    Ok(())
}

#[tauri::command]
pub async fn backup_build() -> Result<serde_json::Value, AppError> {
    crate::services::backup::build_bundle()
}

#[tauri::command]
pub async fn backup_export_file(path: String, bundle: serde_json::Value) -> Result<(), AppError> {
    crate::services::backup::export_to(std::path::Path::new(&path), &bundle)
}

#[tauri::command]
pub async fn backup_import_file(
    state: State<'_, Arc<AppState>>,
    path: String,
) -> Result<(), AppError> {
    crate::services::backup::import_from(std::path::Path::new(&path), &state.locks).await
}

#[tauri::command]
pub async fn versions_list() -> Result<Vec<crate::services::versions::InstalledVersion>, AppError> {
    tokio::task::spawn_blocking(crate::services::versions::list_installed)
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой задачи списка версий")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn versions_available() -> Result<Vec<crate::services::versions::ReleaseInfo>, AppError> {
    tokio::task::spawn_blocking(|| {
        crate::services::versions::fetch_releases_blocking("Flowseal/zapret-discord-youtube")
    })
    .await
    .map_err(|e| {
        AppError::new("INTERNAL", "Сбой запроса версий")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?
}

#[tauri::command]
pub async fn versions_download(
    state: State<'_, Arc<AppState>>,
    version: String,
    asset_url: String,
    asset_name: String,
) -> Result<serde_json::Value, AppError> {
    use crate::services::operations::OperationStatus;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc as StdArc;

    let temp_path = crate::services::versions::temp_download_path(&version, &asset_name)?;
    let archive_path = temp_path.to_string_lossy().into_owned();
    let handle = state
        .operations
        .begin("download", Some("versions"), true)
        .await?;
    let id = handle.snapshot.borrow().id;

    let done = StdArc::new(AtomicU64::new(0));
    let total = StdArc::new(AtomicU64::new(0));
    let (done_tx, total_tx) = (done.clone(), total.clone());
    let cancel = handle.cancel.clone();

    let dl = tokio::task::spawn_blocking(move || {
        let progress = |d: u64, t: u64| {
            done_tx.store(d, Ordering::Relaxed);
            total_tx.store(t, Ordering::Relaxed);
        };
        crate::services::versions::download_blocking(&asset_url, &temp_path, &cancel, &progress)
    });

    let snapshot_rx = handle.snapshot.clone();
    let operations = state.operations.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let d = done.load(Ordering::Relaxed);
            let t = total.load(Ordering::Relaxed);
            if d > 0 && t > 0 {
                let mut snap = snapshot_rx.borrow().clone();
                if snap.status.is_terminal() {
                    break;
                }
                snap.revision += 1;
                snap.progress = Some(crate::services::operations::Progress {
                    current: Some(d),
                    total: Some(t),
                    message: Some(format!(
                        "Скачивание: {} из {} МБ",
                        d / 1_048_576,
                        t / 1_048_576
                    )),
                });
                operations.update(snap).await;
            }
        }
    });
    let result = dl.await.map_err(|e| {
        AppError::new("INTERNAL", "Задача скачивания завершилась аварийно")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    progress_task.abort();
    let mut final_snapshot = handle.snapshot.borrow().clone();
    final_snapshot.revision += 1;
    match result {
        Ok(()) => {
            final_snapshot.status = OperationStatus::Succeeded;
            final_snapshot.message = format!("Zapret {version} скачан");
            final_snapshot.progress = None;
            state
                .operations
                .finish(final_snapshot, Some("versions"))
                .await;
            Ok(serde_json::json!({
                "operationId": id.to_string(),
                "archivePath": archive_path,
            }))
        }
        Err(e) => {
            final_snapshot.status = OperationStatus::Failed;
            final_snapshot.message = e.user_message.clone();
            final_snapshot.error = Some(crate::services::operations::OperationError {
                code: e.code.clone(),
                user_message: e.user_message.clone(),
                details: e.details.clone(),
            });
            state
                .operations
                .finish(final_snapshot, Some("versions"))
                .await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn versions_install(
    state: State<'_, Arc<AppState>>,
    version: String,
    temp_archive: String,
) -> Result<crate::services::versions::InstalledVersion, AppError> {
    let handle = state
        .operations
        .begin("install", Some("versions"), false)
        .await?;
    let mut snapshot = handle.snapshot.borrow().clone();
    snapshot.status = crate::services::operations::OperationStatus::Running;
    snapshot.message = format!("Установка Zapret {version}…");
    state.operations.update(snapshot.clone()).await;

    let archive = std::path::PathBuf::from(&temp_archive);
    let result = tokio::task::spawn_blocking(move || {
        crate::services::versions::install_blocking(&version, &archive)
    })
    .await
    .map_err(|e| {
        AppError::new("INTERNAL", "Задача установки завершилась аварийно")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;

    snapshot.revision += 1;
    match result {
        Ok(info) => {
            snapshot.status = crate::services::operations::OperationStatus::Succeeded;
            snapshot.message = format!("Zapret {} установлен", info.version);
            state.operations.finish(snapshot, Some("versions")).await;
            Ok(info)
        }
        Err(e) => {
            snapshot.status = crate::services::operations::OperationStatus::Failed;
            snapshot.message = e.user_message.clone();
            snapshot.error = Some(crate::services::operations::OperationError {
                code: e.code.clone(),
                user_message: e.user_message.clone(),
                details: e.details.clone(),
            });
            state.operations.finish(snapshot, Some("versions")).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn versions_delete(folder: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || crate::services::versions::delete_version(&folder))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой задачи удаления")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn service_install_plan(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::services::elevation::ElevationPlan, AppError> {
    let dir = flowseal_dir()?;
    state.zapret.set_our_roots(vec![dir.clone()]).await;
    crate::services::zapret_service::service_install_plan(&dir)
}

#[tauri::command]
pub async fn service_install(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    run_service_elevation(&state, "service_install", |dir| {
        crate::services::zapret_service::service_install_plan(&dir)
    })
    .await
}

#[tauri::command]
pub async fn service_remove(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, AppError> {
    run_service_elevation(&state, "service_remove", |_| {
        Ok(crate::services::zapret_service::service_remove_plan())
    })
    .await
}

async fn run_service_elevation(
    state: &State<'_, Arc<AppState>>,
    kind: &str,
    plan_builder: impl FnOnce(
        std::path::PathBuf,
    ) -> Result<crate::services::elevation::ElevationPlan, AppError>,
) -> Result<serde_json::Value, AppError> {
    use crate::services::operations::OperationStatus;
    let plan = plan_builder(flowseal_dir()?)?;
    let handle = state.operations.begin(kind, Some("service"), false).await?;
    let mut snapshot = handle.snapshot.borrow().clone();
    snapshot.status = OperationStatus::Running;
    snapshot.message = format!("{}… (подтвердите запрос UAC)", plan.description);
    state.operations.update(snapshot.clone()).await;

    let result = tokio::task::spawn_blocking(move || {
        crate::services::elevation::run_elevated(&plan, std::time::Duration::from_secs(180))
    })
    .await
    .map_err(|e| {
        AppError::new("INTERNAL", "Задача повышения завершилась аварийно")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;

    snapshot.revision += 1;
    let fold = |snapshot: &mut crate::services::operations::OperationSnapshot,
                report: Result<crate::services::elevation::ElevationReport, AppError>|
     -> Result<(), AppError> {
        match report {
            Ok(report) if report.ok => {
                snapshot.status = OperationStatus::Succeeded;
                snapshot.message = "Готово".into();
                Ok(())
            }
            Ok(report) => {
                snapshot.status = OperationStatus::Failed;
                snapshot.message = report
                    .error
                    .as_deref()
                    .unwrap_or("Хотя бы один шаг не выполнен")
                    .to_string();
                snapshot.error = Some(crate::services::operations::OperationError::new(
                    "ELEVATION_STEP_FAILED",
                    "Сценарий с повышением выполнен с ошибками — детали в отчёте операции",
                ));
                Err(AppError::new(
                    "ELEVATION_STEP_FAILED",
                    "Сценарий с повышением выполнен с ошибками",
                )
                .with_details(serde_json::to_value(&report).unwrap_or_default()))
            }
            Err(e) => {
                snapshot.status = OperationStatus::Failed;
                snapshot.message = e.user_message.clone();
                snapshot.error = Some(crate::services::operations::OperationError::new(
                    &e.code,
                    &e.user_message,
                ));
                Err(e)
            }
        }
    };

    let outcome = fold(&mut snapshot, result);
    state.operations.finish(snapshot, Some("service")).await;
    outcome?;

    let status = crate::services::service_query::query_service(
        crate::services::zapret_service::ZAPRET_SERVICE_NAME,
    )
    .await?;
    if kind == "service_install" && (!status.installed || !status.running) {
        return Err(AppError::new(
            "SERVICE_NOT_RUNNING",
            if status.installed {
                "Служба zapret создана, но не запустилась. Проверьте диагностику (WinDivert, конфликты стратегий)"
            } else {
                "Служба zapret не создана"
            },
        ));
    }
    if kind == "service_install" {
        state.sink.notify(
            "Автозапуск zapret включён",
            "Служба Windows запускает zapret вместе с системой — окно Control не требуется.",
        );
    } else {
        state.sink.notify(
            "Автозапуск zapret выключен",
            "Служба zapret удалена. Защиту можно запускать вручную из Control.",
        );
    }
    Ok(serde_json::json!({ "installed": status.installed, "running": status.running }))
}

#[tauri::command]
pub async fn presets_list() -> Result<Vec<crate::services::presets::Preset>, AppError> {
    tokio::task::spawn_blocking(crate::services::presets::list)
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой задачи списка пресетов")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn preset_save(name: String, content: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || crate::services::presets::save(&name, &content))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой сохранения пресета")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn preset_delete(name: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || crate::services::presets::delete(&name))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой удаления пресета")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn setup_run_checks(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::services::diagnostics::EnvironmentChecks, AppError> {
    crate::services::diagnostics::run_checks(&state).await
}

#[tauri::command]
pub async fn setup_default_dir() -> Result<String, AppError> {
    tokio::task::spawn_blocking(crate::services::diagnostics::default_dir_blocking)
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой задачи выбора папки")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })
}

#[tauri::command]
pub async fn setup_apply(
    state: State<'_, Arc<AppState>>,
    options: serde_json::Value,
) -> Result<(), AppError> {
    let snapshot = crate::storage::settings::read_settings_recovering()?;
    let mut content = snapshot.content.clone();
    if content.is_null() || !content.is_object() {
        content = serde_json::json!({});
    }
    if let Some(dir) = options.get("controlDir").and_then(|v| v.as_str()) {
        if dir.is_empty() || dir.contains('\0') {
            return Err(AppError::new(
                "INVALID_ARGUMENT",
                "Некорректная папка Control",
            ));
        }
        let path = std::path::PathBuf::from(dir);

        std::fs::create_dir_all(&path).map_err(|e| {
            AppError::new("IO_ERROR", "Не удалось создать папку Control")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
        content["controlDir"] = serde_json::json!(path.to_string_lossy());
        content["dataDirConfirmed"] = serde_json::json!(true);
    }
    for key in ["minimizeToTray", "notifications", "restoreState"] {
        if let Some(v) = options.get(key).and_then(|v| v.as_bool()) {
            content[key] = serde_json::json!(v);
        }
    }
    crate::storage::settings::write_settings_checked(&state.locks, &snapshot, content).await
}

#[tauri::command]
pub async fn control_select_version(
    state: State<'_, Arc<AppState>>,
    version_folder: String,
) -> Result<(), AppError> {
    select_version_inner(&state, &version_folder).await
}

#[tauri::command]
pub async fn versions_select(
    state: State<'_, Arc<AppState>>,
    folder: String,
) -> Result<bool, AppError> {
    select_version_inner(&state, &folder).await?;
    live_apply_current_strategy(&state).await
}

#[tauri::command]
pub async fn versions_open_folder(folder: String) -> Result<(), AppError> {
    if !crate::services::versions::version_folder_re().is_match(&folder) {
        return Err(AppError::new("INVALID_ARGUMENT", "Некорректное имя версии"));
    }
    let raw = crate::storage::settings::read_settings_raw()?;
    let control_dir = crate::storage::settings::settings_str(&raw, "controlDir")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| AppError::new("NO_CONTROL_DIR", "Папка Control не выбрана"))?;
    let dir = control_dir.join(&folder);
    if !dir.is_dir() {
        return Err(AppError::new("NOT_FOUND", "Папка версии не найдена"));
    }
    open_in_explorer(&dir)
}

#[tauri::command]
pub async fn profiles_open_folder() -> Result<(), AppError> {
    open_in_explorer(&crate::services::profiles::profiles_dir()?)
}

fn open_in_explorer(path: &std::path::Path) -> Result<(), AppError> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("explorer")
        .arg(path)
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|e| {
            AppError::new("OPEN_FAILED", "Не удалось открыть папку в Проводнике")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?;
    Ok(())
}

async fn select_version_inner(state: &Arc<AppState>, version_folder: &str) -> Result<(), AppError> {
    if !crate::services::versions::version_folder_re().is_match(version_folder) {
        return Err(AppError::new("INVALID_ARGUMENT", "Некорректное имя версии"));
    }
    let raw = crate::storage::settings::read_settings_raw()?;
    let control_dir = crate::storage::settings::settings_str(&raw, "controlDir")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| {
            AppError::new("NO_CONTROL_DIR", "Сначала выберите папку Control в мастере")
        })?;
    let version_dir = control_dir.join(version_folder);
    if !version_dir.join("bin").join("winws.exe").is_file() {
        return Err(AppError::new("NOT_FOUND", "В этой папке нет bin/winws.exe"));
    }

    let snapshot = crate::storage::settings::read_settings_recovering()?;
    let mut content = snapshot.content.clone();
    content["selectedVersion"] = serde_json::json!(version_folder);
    crate::storage::settings::write_settings_checked(&state.locks, &snapshot, content).await?;

    let lists_dir = version_dir.join("lists");
    if lists_dir.is_dir() {
        for (_, file, _) in crate::services::filters::LIST_FILES {
            let full = lists_dir.join(file);
            if !full.exists() {
                std::fs::write(&full, b"").map_err(|e| {
                    AppError::new("IO_ERROR", "Не удалось создать пустой список")
                        .with_details(serde_json::json!({ "error": e.to_string() }))
                })?;
            }
        }
    }
    Ok(())
}

async fn live_apply_current_strategy(state: &Arc<AppState>) -> Result<bool, AppError> {
    let settings = crate::storage::settings::read_settings_raw()?;
    let Some(dir) = crate::storage::settings::find_flowseal_dir(&settings) else {
        return Ok(false);
    };
    let saved = crate::storage::settings::settings_str(&settings, "lastStrategy")
        .unwrap_or("")
        .to_string();
    let strategies = crate::storage::settings::list_strategies(&dir);
    let chosen = strategies
        .iter()
        .find(|s| s.value == saved || s.filename == saved)
        .or_else(|| strategies.first());
    let Some(chosen) = chosen else {
        return Ok(false);
    };
    let game_mode = crate::storage::settings::game_filter_mode(&dir);
    state
        .control
        .reconfigure_with(chosen.path.clone(), dir, game_mode)
        .await
}

fn flowseal_dir() -> Result<std::path::PathBuf, AppError> {
    let settings = crate::storage::settings::read_settings_raw()?;
    crate::storage::settings::find_flowseal_dir(&settings).ok_or_else(|| {
        AppError::new(
            "NO_ZAPRET_INSTALL",
            "Установка Zapret не найдена. Установите или выберите версию",
        )
    })
}

#[tauri::command]
pub async fn strategies_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::storage::settings::StrategyInfo>, AppError> {
    let dir = flowseal_dir()?;
    state.zapret.set_our_roots(vec![dir.clone()]).await;
    let mut strategies = crate::storage::settings::list_strategies(&dir);
    for preset in crate::services::presets::list()? {
        strategies.push(crate::storage::settings::StrategyInfo {
            value: format!("preset:{}", preset.name),
            filename: preset.filename.clone(),
            label: preset.name.clone(),

            path: crate::storage::settings::app_data_dir()?
                .join("presets")
                .join(&preset.filename),
            kind: "preset".into(),
        });
    }
    Ok(strategies)
}

#[tauri::command]
pub async fn profiles_list() -> Result<Vec<crate::services::profiles::Profile>, AppError> {
    tokio::task::spawn_blocking(crate::services::profiles::list)
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой задачи списка профилей")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn profile_save(
    profile: crate::services::profiles::Profile,
) -> Result<crate::services::profiles::Profile, AppError> {
    tokio::task::spawn_blocking(move || crate::services::profiles::save(profile))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой сохранения профиля")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn profile_delete(id: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || crate::services::profiles::delete(&id))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой удаления профиля")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn profile_apply(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<crate::services::profiles::AppliedProfile, AppError> {
    let profile = tokio::task::spawn_blocking(move || crate::services::profiles::get(&id))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой чтения профиля")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })??;
    persist_last_strategy(&state, &profile.strategy).await;
    crate::services::profiles::apply(&profile, &state).await
}

#[tauri::command]
pub async fn profile_export_text(id: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || crate::services::profiles::export_text(&id))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой экспорта профиля")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn profile_export_file(path: String, id: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        crate::services::profiles::export_file(std::path::Path::new(&path), &id)
    })
    .await
    .map_err(|e| {
        AppError::new("INTERNAL", "Сбой экспорта профиля")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?
}

#[tauri::command]
pub async fn profile_import_text(
    text: String,
) -> Result<crate::services::profiles::Profile, AppError> {
    tokio::task::spawn_blocking(move || crate::services::profiles::import_text(&text))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой импорта профиля")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn diagnostics_run(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::services::diagnostics::DiagnosticsReport, AppError> {
    crate::services::diagnostics::run_deep(state.inner().clone()).await
}

#[tauri::command]
pub async fn tgws_status() -> Result<crate::services::tgws::TgwsStatus, AppError> {
    Ok(crate::services::tgws::status().await)
}

#[tauri::command]
pub async fn tgws_install(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::services::tgws::InstallResult, AppError> {
    use crate::services::operations::OperationStatus;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc as StdArc;

    let handle = state
        .operations
        .begin("tgws_install", Some("tgws"), false)
        .await?;
    let done = StdArc::new(AtomicU64::new(0));
    let total = StdArc::new(AtomicU64::new(0));
    let (done_tx, total_tx) = (done.clone(), total.clone());
    let download = tokio::task::spawn_blocking(move || {
        let progress = |d: u64, t: u64| {
            done_tx.store(d, Ordering::Relaxed);
            total_tx.store(t, Ordering::Relaxed);
        };
        crate::services::tgws::install_blocking(&progress)
    });

    let snapshot_rx = handle.snapshot.clone();
    let operations = state.operations.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let d = done.load(Ordering::Relaxed);
            let t = total.load(Ordering::Relaxed);
            if d > 0 && t > 0 {
                let mut snap = snapshot_rx.borrow().clone();
                if snap.status.is_terminal() {
                    break;
                }
                snap.revision += 1;
                snap.status = OperationStatus::Running;
                snap.progress = Some(crate::services::operations::Progress {
                    current: Some(d),
                    total: Some(t),
                    message: Some(format!(
                        "Скачивание TG WS Proxy: {} из {} МБ",
                        d / 1_048_576,
                        t / 1_048_576
                    )),
                });
                operations.update(snap).await;
            }
        }
    });
    let result = download.await.map_err(|e| {
        AppError::new("INTERNAL", "Задача загрузки завершилась аварийно")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    progress_task.abort();
    let mut snapshot = handle.snapshot.borrow().clone();
    snapshot.revision += 1;
    match result {
        Ok(info) => {
            snapshot.status = OperationStatus::Succeeded;
            snapshot.progress = None;
            snapshot.message = format!("TG WS Proxy {} установлен", info.version);
            state.operations.finish(snapshot, Some("tgws")).await;
            Ok(info)
        }
        Err(e) => {
            snapshot.status = OperationStatus::Failed;
            snapshot.message = e.user_message.clone();
            snapshot.error = Some(crate::services::operations::OperationError {
                code: e.code.clone(),
                user_message: e.user_message.clone(),
                details: e.details.clone(),
            });
            state.operations.finish(snapshot, Some("tgws")).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn tgws_start(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::services::tgws::TgwsStatus, AppError> {
    let status = crate::services::tgws::start().await?;
    state.sink.notify(
        "TG Proxy запущен",
        &format!("Прокси слушает {}:{}", status.host, status.port),
    );
    Ok(status)
}

#[tauri::command]
pub async fn tgws_stop(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::services::tgws::TgwsStatus, AppError> {
    let status = crate::services::tgws::stop().await?;
    state.sink.notify(
        "TG Proxy остановлен",
        "Telegram снова подключается напрямую.",
    );
    Ok(status)
}

#[tauri::command]
pub async fn tgws_uninstall() -> Result<crate::services::tgws::TgwsStatus, AppError> {
    crate::services::tgws::uninstall().await
}

#[tauri::command]
pub async fn tgws_set_port(port: u16) -> Result<crate::services::tgws::TgwsStatus, AppError> {
    crate::services::tgws::set_port(port).await
}

#[tauri::command]
pub async fn tgws_open_telegram() -> Result<(), AppError> {
    crate::services::tgws::open_telegram()
}

#[tauri::command]
pub async fn tgws_logs(lines: Option<usize>) -> Result<Vec<String>, AppError> {
    crate::services::tgws::logs(lines.unwrap_or(120).min(2000))
}

#[tauri::command]
pub async fn autostart_get() -> Result<bool, AppError> {
    Ok(crate::services::autostart::is_enabled())
}

#[tauri::command]
pub async fn autostart_info() -> Result<crate::services::autostart::AutostartInfo, AppError> {
    Ok(crate::services::autostart::info())
}

#[tauri::command]
pub async fn autostart_set(enabled: bool) -> Result<bool, AppError> {
    crate::services::autostart::set_enabled(enabled)?;
    Ok(crate::services::autostart::is_enabled())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorApplyResult {
    pub strategy: String,
    pub started: bool,
    pub live_applied: bool,
}

#[tauri::command]
pub async fn advisor_scan(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::services::advisor::AdvisorReport, AppError> {
    crate::services::advisor::scan(state.inner().as_ref()).await
}

#[tauri::command]
pub async fn advisor_saved() -> Result<Option<crate::services::advisor::AdvisorReport>, AppError> {
    let snapshot = crate::storage::settings::read_settings_recovering()?;
    Ok(snapshot
        .content
        .get("advisor")
        .and_then(|value| serde_json::from_value(value.clone()).ok()))
}

#[tauri::command]
pub async fn advisor_apply(
    state: State<'_, Arc<AppState>>,
    strategy_value: String,
) -> Result<AdvisorApplyResult, AppError> {
    let (strategy_path, dir, game_mode) = resolve_strategy(&state, &strategy_value).await?;
    persist_last_strategy(&state, &strategy_value).await;
    let live_applied = state
        .control
        .reconfigure_with(strategy_path.clone(), dir.clone(), game_mode)
        .await?;
    if !live_applied {
        state.control.start(strategy_path, dir, game_mode).await?;
    }
    Ok(AdvisorApplyResult {
        strategy: strategy_value,
        started: true,
        live_applied,
    })
}

#[tauri::command]
pub async fn update_check() -> Result<crate::services::updater::UpdateInfo, AppError> {
    tokio::task::spawn_blocking(crate::services::updater::check_blocking)
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой проверки обновлений")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })?
}

#[tauri::command]
pub async fn update_download(
    state: State<'_, Arc<AppState>>,
    version: String,
    asset_url: String,
) -> Result<String, AppError> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc as StdArc;

    if !asset_url.starts_with("https://") {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Разрешены только https-ссылки",
        ));
    }
    let cancel = tokio_util::sync::CancellationToken::new();
    let done = StdArc::new(AtomicU64::new(0));
    let total = StdArc::new(AtomicU64::new(0));
    let (done_tx, total_tx) = (done.clone(), total.clone());

    let download = tokio::task::spawn_blocking(move || {
        let progress = |d: u64, t: u64| {
            done_tx.store(d, Ordering::Relaxed);
            total_tx.store(t, Ordering::Relaxed);
        };
        crate::services::updater::download_blocking(&asset_url, &version, &cancel, &progress)
    });

    let sink = state.sink.clone();
    let progress_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let d = done.load(Ordering::Relaxed);
            let t = total.load(Ordering::Relaxed);
            if t > 0 {
                sink.emit_json(
                    "update://progress",
                    serde_json::json!({ "downloaded": d, "total": t }),
                );
            }
        }
    });

    let result = download.await.map_err(|e| {
        AppError::new("INTERNAL", "Задача обновления завершилась аварийно")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    progress_task.abort();
    let path = result?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, installer_path: String) -> Result<(), AppError> {
    let path = std::path::PathBuf::from(&installer_path);
    let updates = crate::storage::settings::app_data_dir()?.join("updates");
    let base = updates.canonicalize().unwrap_or(updates);
    let canonical = path.canonicalize().map_err(|e| {
        AppError::new("INSTALLER_MISSING", "Файл обновления не найден")
            .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    if !canonical.starts_with(&base) {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "Некорректный путь к обновлению",
        ));
    }

    tokio::task::spawn_blocking(move || crate::services::updater::launch_installer(&canonical))
        .await
        .map_err(|e| {
            AppError::new("INTERNAL", "Сбой запуска обновления")
                .with_details(serde_json::json!({ "error": e.to_string() }))
        })??;

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        app.exit(0);
    });
    Ok(())
}

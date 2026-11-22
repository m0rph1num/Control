mod commands;
mod domain;
mod errors;
mod services;
mod state;
mod storage;

use std::sync::Arc;
use tauri::{Manager, WebviewWindowBuilder};

pub use errors::AppError;

#[cfg(windows)]
mod single_instance {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        GetLastError, SetLastError, ERROR_ALREADY_EXISTS, ERROR_SUCCESS,
    };
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, IsIconic, SetForegroundWindow, ShowWindow, SwitchToThisWindow, SW_RESTORE,
        SW_SHOW,
    };

    const MUTEX_NAME: &str = "Local\\Control-single-instance";
    const WINDOW_TITLE: &str = "Control";

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn acquire() -> bool {
        let name = wide(MUTEX_NAME);
        unsafe { SetLastError(ERROR_SUCCESS) };
        match unsafe { CreateMutexW(None, false, PCWSTR::from_raw(name.as_ptr())) } {
            Ok(handle) => {
                if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
                    return false;
                }
                let _ = handle;
                true
            }
            Err(_) => true,
        }
    }

    pub fn focus_existing() {
        let title = wide(WINDOW_TITLE);
        let Ok(window) = (unsafe { FindWindowW(PCWSTR::null(), PCWSTR::from_raw(title.as_ptr())) })
        else {
            return;
        };
        unsafe {
            if IsIconic(window).as_bool() {
                let _ = ShowWindow(window, SW_RESTORE);
            } else {
                let _ = ShowWindow(window, SW_SHOW);
            }
            if !SetForegroundWindow(window).as_bool() {
                SwitchToThisWindow(window, true);
            }
        }
    }
}

#[cfg(not(windows))]
mod single_instance {
    pub fn acquire() -> bool {
        true
    }

    pub fn focus_existing() {}
}

pub fn write_shortcut_helper() -> bool {
    services::toast::write_shortcut_helper()
}

pub fn run() {
    let log = services::logging::init();
    services::logging::install_panic_hook();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,control_lib=debug".into()),
        )
        .with_writer(log)
        .init();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        pid = std::process::id(),
        "Control запущен"
    );

    if !single_instance::acquire() {
        tracing::info!("найден уже запущенный Control, завершаю второй экземпляр");
        if !services::autostart::launched_minimized() {
            single_instance::focus_existing();
        }
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            storage::settings::migrate_legacy_settings();
            services::autostart::migrate_legacy();
            let sink: Arc<dyn services::events::EventSink> =
                Arc::new(services::events::TauriEventSink::new(app.handle().clone()));
            let app_state: Arc<state::AppState> = Arc::new(state::AppState::new(
                env!("CARGO_PKG_VERSION"),
                sink.clone(),
            ));
            app.manage(app_state.clone());

            if let Some(window_config) = app.config().app.windows.first().cloned() {
                WebviewWindowBuilder::from_config(app.handle(), &window_config)?.build()?;
            }

            let ops_sink = sink.clone();
            let operations = app_state.operations.clone();
            tauri::async_runtime::spawn(async move {
                operations.set_sink(ops_sink).await;
            });

            let handle = app.handle().clone();
            app_state.control.spawn_supervisor();

            services::toast::ensure_identity();
            services::toast::spawn_shortcut_helper();

            if services::autostart::launched_minimized() {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            services::tray::create(&handle, app_state.clone())?;

            if let Ok(data_dir) = storage::settings::app_data_dir() {
                let removed = storage::atomic::cleanup_temp_files(&data_dir);
                if removed > 0 {
                    tracing::info!(removed, "очищены осиротевшие tmp-файлы");
                }
            }
            tauri::async_runtime::spawn(async move {
                let _ = app_state.zapret.refresh().await;
            });

            if services::tgws::autostart_ready() {
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = services::tgws::start().await {
                        tracing::warn!(
                            code = %error.code,
                            message = %error.user_message,
                            "не удалось автозапустить TG WS Proxy"
                        );
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::startup_flags,
            commands::operations_list,
            commands::operations_cancel,
            commands::protection_status,
            commands::protection_snapshot,
            commands::protection_start,
            commands::protection_stop,
            commands::service_status,
            commands::windivert_status,
            commands::strategies_list,
            commands::settings_get,
            commands::settings_set,
            commands::settings_update,
            commands::flowseal_config_get,
            commands::flowseal_config_set,
            commands::lists_get,
            commands::lists_write,
            commands::game_filter_get,
            commands::game_filter_set,
            commands::ipset_filter_get,
            commands::ipset_filter_set,
            commands::fakes_get,
            commands::fakes_set,
            commands::backup_build,
            commands::backup_export_file,
            commands::backup_import_file,
            commands::versions_list,
            commands::versions_available,
            commands::versions_download,
            commands::versions_install,
            commands::versions_delete,
            commands::service_install_plan,
            commands::service_install,
            commands::service_remove,
            commands::setup_run_checks,
            commands::setup_default_dir,
            commands::presets_list,
            commands::preset_save,
            commands::preset_delete,
            commands::setup_apply,
            commands::control_select_version,
            commands::protection_apply,
            commands::versions_select,
            commands::versions_open_folder,
            commands::profiles_list,
            commands::profile_save,
            commands::profile_delete,
            commands::profile_apply,
            commands::profile_export_text,
            commands::profile_export_file,
            commands::profile_import_text,
            commands::profiles_open_folder,
            commands::diagnostics_run,
            commands::tgws_status,
            commands::tgws_install,
            commands::tgws_start,
            commands::tgws_stop,
            commands::tgws_uninstall,
            commands::tgws_set_port,
            commands::tgws_open_telegram,
            commands::tgws_logs,
            commands::autostart_get,
            commands::autostart_info,
            commands::autostart_set,
            commands::advisor_scan,
            commands::advisor_saved,
            commands::advisor_apply,
            commands::update_check,
            commands::update_download,
            commands::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("запуск Tauri-приложения завершился ошибкой");
}

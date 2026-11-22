use crate::state::AppState;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WindowEvent};

pub fn create<R: Runtime>(app: &AppHandle<R>, state: Arc<AppState>) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Показать Control", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "Запустить защиту", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Остановить защиту", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", "Открыть журнал", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &start, &stop, &logs, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?,
        )
        .tooltip("Control — Zapret GUI")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        })
        .on_menu_event(move |app, event| {
            let state = state.clone();
            match event.id().as_ref() {
                "toggle" => toggle_window(app),
                "start" => {
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = start_protection(&state).await {
                            tracing::warn!(error = %e.user_message, "tray: не удалось запустить защиту");
                            state.sink.notify("Защита не запустилась", &e.user_message);
                        }
                    });
                }
                "stop" => {
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = state.control.stop().await {
                            tracing::warn!(error = %e.user_message, "tray: не удалось остановить защиту");
                            state.sink.notify("Защита не остановлена", &e.user_message);
                        }
                    });
                }
                "logs" => open_log(),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    if let Some(win) = app.get_webview_window("main") {
        let win_for_close = win.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let minimize = crate::storage::settings::read_settings_raw()
                    .ok()
                    .and_then(|s| s.get("minimizeToTray").and_then(|v| v.as_bool()))
                    .unwrap_or(true);
                if minimize {
                    api.prevent_close();
                    let _ = win_for_close.hide();
                }
            }
        });
    }
    Ok(())
}

fn open_log() {
    let Some(path) = crate::services::logging::path() else {
        return;
    };
    let target = if path.is_file() {
        format!("/select,{}", path.display())
    } else {
        path.parent()
            .map(|p| p.display().to_string())
            .unwrap_or_default()
    };
    let mut cmd = std::process::Command::new("explorer");
    cmd.arg(target);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd.spawn();
}

fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        let focused = win.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

async fn start_protection(state: &Arc<AppState>) -> Result<(), crate::errors::AppError> {
    let settings = crate::storage::settings::read_settings_raw()?;
    let dir = crate::storage::settings::find_flowseal_dir(&settings).ok_or_else(|| {
        crate::errors::AppError::new("NO_ZAPRET_INSTALL", "Установка Zapret не найдена")
    })?;
    let strategies = crate::storage::settings::list_strategies(&dir);
    let saved =
        crate::storage::settings::settings_str(&settings, "lastStrategy").unwrap_or_default();
    let strategy = strategies
        .iter()
        .find(|s| s.value == saved)
        .or_else(|| strategies.first())
        .ok_or_else(|| crate::errors::AppError::new("NO_STRATEGIES", "Стратегии не найдены"))?
        .clone();
    let game_mode = crate::storage::settings::game_filter_mode(&dir);
    let path = strategy.path;
    state.control.start(path, dir, game_mode).await.map(|_| ())
}

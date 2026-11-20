pub trait EventSink: Send + Sync {
    fn emit_json(&self, event: &str, payload: serde_json::Value);

    fn notify(&self, _title: &str, _body: &str) {}
}

const TOAST_ICON: &[u8] = include_bytes!("../../icons/icon.png");

fn toast_icon() -> Option<std::path::PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    let path = std::path::Path::new(&appdata)
        .join("control")
        .join("notification.png");
    if !path.exists() {
        std::fs::create_dir_all(path.parent()?).ok()?;
        std::fs::write(&path, TOAST_ICON).ok()?;
    }
    Some(path)
}

pub struct TauriEventSink {
    app: tauri::AppHandle,
}

impl EventSink for TauriEventSink {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        use tauri::Emitter;
        let _ = self.app.emit(event, payload);
    }

    fn notify(&self, title: &str, body: &str) {
        use tauri::Manager;
        if !crate::storage::settings::notifications_enabled() {
            return;
        }
        let focused = self
            .app
            .get_webview_window("main")
            .and_then(|window| window.is_focused().ok())
            .unwrap_or(false);
        if focused {
            return;
        }
        use tauri_plugin_notification::NotificationExt;
        let mut builder = self.app.notification().builder().title(title).body(body);
        if let Some(icon) = toast_icon() {
            builder = builder.icon(icon.display().to_string());
        }
        if let Err(error) = builder.show() {
            tracing::warn!(%error, "не удалось показать системное уведомление");
        }
    }
}

impl TauriEventSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

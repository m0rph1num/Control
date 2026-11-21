pub trait EventSink: Send + Sync {
    fn emit_json(&self, event: &str, payload: serde_json::Value);

    fn notify(&self, _title: &str, _body: &str) {}
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
        let title = title.to_string();
        let body = body.to_string();
        std::thread::spawn(move || {
            if let Err(error) = crate::services::toast::show(&title, &body) {
                tracing::warn!(%error, "не удалось показать системное уведомление");
            }
        });
    }
}

impl TauriEventSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

use serde::Serialize;

#[derive(Debug, Serialize, Clone, thiserror::Error)]
#[error("{user_message}")]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub user_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(code: &str, user_message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            user_message: user_message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::new("IO_ERROR", "Ошибка доступа к файлам или системным ресурсам")
            .with_details(serde_json::json!({ "osError": err.to_string() }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_stable_code_and_user_message() {
        let err = AppError::new("IO_ERROR", "Ошибка доступа");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "IO_ERROR");
        assert_eq!(json["userMessage"], "Ошибка доступа");
        assert!(json.get("details").is_none());
    }
}

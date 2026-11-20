#![allow(dead_code)]

use crate::errors::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use tokio::sync::{watch, Mutex};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl OperationStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            OperationStatus::Succeeded | OperationStatus::Failed | OperationStatus::Cancelled
        )
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct OperationError {
    pub code: String,
    pub user_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl OperationError {
    pub fn new(code: &str, user_message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            user_message: user_message.into(),
            details: None,
        }
    }
}

impl From<AppError> for OperationError {
    fn from(err: AppError) -> Self {
        Self {
            code: err.code,
            user_message: err.user_message,
            details: err.details,
        }
    }
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshot {
    pub id: Uuid,
    pub kind: String,
    pub status: OperationStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<Progress>,
    pub message: String,

    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<OperationError>,
    pub cancelable: bool,
}

impl OperationSnapshot {
    fn queued(kind: &str, cancelable: bool) -> Self {
        Self {
            id: Uuid::new_v4(),
            kind: kind.to_string(),
            status: OperationStatus::Queued,
            started_at: Some(Utc::now()),
            finished_at: None,
            progress: None,
            message: "Операция в очереди".to_string(),
            revision: 0,
            error: None,
            cancelable,
        }
    }
}

pub struct OperationHandle {
    pub snapshot: watch::Receiver<OperationSnapshot>,
    pub cancel: tokio_util::sync::CancellationToken,
}

#[derive(Default)]
pub struct OperationManager {
    operations: Mutex<HashMap<Uuid, (watch::Sender<OperationSnapshot>, CancellationToken)>>,

    locks: Mutex<HashMap<String, Uuid>>,

    sink: Mutex<Option<std::sync::Arc<dyn crate::services::events::EventSink>>>,
}

impl OperationManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn set_sink(&self, sink: std::sync::Arc<dyn crate::services::events::EventSink>) {
        *self.sink.lock().await = Some(sink);
    }

    async fn emit(&self, snapshot: &OperationSnapshot) {
        let sink = self.sink.lock().await.clone();
        if let Some(sink) = sink {
            if let Ok(payload) = serde_json::to_value(snapshot) {
                sink.emit_json("operation://state", payload);
            }
        }
    }

    pub async fn begin(
        &self,
        kind: &str,
        resource: Option<&str>,
        cancelable: bool,
    ) -> Result<OperationHandle, AppError> {
        let mut locks = self.locks.lock().await;
        if let Some(res) = resource {
            if let Some(&existing) = locks.get(res) {
                if let Some((tx, _)) = self.operations.lock().await.get(&existing) {
                    if !tx.borrow().status.is_terminal() {
                        return Err(AppError::new(
                            "ALREADY_RUNNING",
                            "Операция уже выполняется; дождитесь её завершения",
                        )
                        .with_details(serde_json::json!({ "operationId": existing.to_string() })));
                    }
                }
            }
        }

        let snapshot = OperationSnapshot::queued(kind, cancelable);
        let (tx, rx) = watch::channel(snapshot);
        let id = rx.borrow().id;
        let cancel = CancellationToken::new();
        if let Some(res) = resource {
            locks.insert(res.to_string(), id);
        }
        self.operations
            .lock()
            .await
            .insert(id, (tx, cancel.clone()));
        let initial = rx.borrow().clone();
        self.emit(&initial).await;
        Ok(OperationHandle {
            snapshot: rx,
            cancel,
        })
    }

    pub async fn cancel(&self, id: Uuid) -> bool {
        match self.operations.lock().await.get(&id) {
            Some((tx, token)) => {
                let cancelled = !tx.borrow().status.is_terminal();
                token.cancel();
                cancelled
            }
            None => false,
        }
    }

    pub async fn update(&self, snapshot: OperationSnapshot) {
        self.emit(&snapshot).await;
        if let Some((tx, _)) = self.operations.lock().await.get(&snapshot.id) {
            let _ = tx.send(snapshot);
        }
    }

    pub async fn finish(&self, snapshot: OperationSnapshot, resource: Option<&str>) {
        debug_assert!(snapshot.status.is_terminal());
        if let Some(res) = resource {
            let mut locks = self.locks.lock().await;
            if locks.get(res) == Some(&snapshot.id) {
                locks.remove(res);
            }
        }
        self.update(snapshot.clone()).await;

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        self.operations.lock().await.remove(&snapshot.id);
    }

    pub async fn get(&self, id: Uuid) -> Option<OperationSnapshot> {
        self.operations
            .lock()
            .await
            .get(&id)
            .map(|(tx, _)| tx.borrow().clone())
    }

    pub async fn list(&self) -> Vec<OperationSnapshot> {
        self.operations
            .lock()
            .await
            .values()
            .map(|(tx, _)| tx.borrow().clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn begin_sets_queued_status() {
        let mgr = OperationManager::new();
        let handle = mgr.begin("test", None, true).await.unwrap();
        let snap = handle.snapshot.borrow().clone();
        assert_eq!(snap.status, OperationStatus::Queued);
        assert!(snap.cancelable);
    }

    #[tokio::test]
    async fn duplicate_resource_operation_is_rejected() {
        let mgr = OperationManager::new();
        let _first = mgr.begin("test", Some("winws"), true).await.unwrap();
        let second = match mgr.begin("test", Some("winws"), true).await {
            Err(e) => e,
            Ok(_) => panic!("duplicate operation must be rejected"),
        };
        assert_eq!(second.code, "ALREADY_RUNNING");
    }

    #[tokio::test]
    async fn finish_releases_resource_lock() {
        let mgr = OperationManager::new();
        let handle = mgr.begin("test", Some("res"), false).await.unwrap();
        let mut snap = handle.snapshot.borrow().clone();
        snap.status = OperationStatus::Succeeded;
        snap.revision += 1;
        mgr.finish(snap, Some("res")).await;
        let _again = mgr.begin("test", Some("res"), false).await.unwrap();
    }

    #[tokio::test]
    async fn update_advances_revision_snapshot() {
        let mgr = OperationManager::new();
        let handle = mgr.begin("test", None, true).await.unwrap();
        let mut snap = handle.snapshot.borrow().clone();
        snap.status = OperationStatus::Running;
        snap.revision += 1;
        snap.message = "Работает".into();
        let id = snap.id;
        mgr.update(snap).await;
        let current = mgr.get(id).await.unwrap();
        assert_eq!(current.status, OperationStatus::Running);
        assert_eq!(current.revision, 1);
    }
}

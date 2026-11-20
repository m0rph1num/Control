use crate::services::events::EventSink;
use crate::services::operations::OperationManager;
use crate::services::zapret::ZapretService;
use crate::services::zapret_control::ZapretControl;
use crate::storage::locks::ResourceLocks;
use std::sync::Arc;

pub struct AppState {
    pub version: String,
    pub sink: Arc<dyn EventSink>,
    pub operations: Arc<OperationManager>,
    pub zapret: Arc<ZapretService>,
    pub control: Arc<ZapretControl>,
    pub locks: Arc<ResourceLocks>,
}

impl AppState {
    pub fn new(version: &str, sink: Arc<dyn EventSink>) -> Self {
        let operations = Arc::new(OperationManager::new());
        let zapret = Arc::new(ZapretService::new(sink.clone()));
        let control = Arc::new(ZapretControl::new(operations.clone(), zapret.clone()));
        Self {
            version: version.to_string(),
            sink,
            operations,
            zapret,
            control,
            locks: Arc::new(ResourceLocks::new()),
        }
    }
}

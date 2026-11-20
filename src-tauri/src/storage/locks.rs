use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct ResourceLocks {
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl ResourceLocks {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, resource: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self.locks.lock().unwrap();
        map.entry(resource.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    pub async fn with_lock<R, Fut>(&self, resource: &str, f: impl FnOnce() -> Fut) -> R
    where
        Fut: std::future::Future<Output = R>,
    {
        let lock = self.get(resource);
        let _guard = lock.lock().await;
        f().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn serializes_concurrent_writers() {
        let locks = Arc::new(ResourceLocks::new());
        let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let max_concurrent = Arc::new(std::sync::atomic::AtomicUsize::new(0));

        let mut tasks = Vec::new();
        for _ in 0..8 {
            let locks = locks.clone();
            let counter = counter.clone();
            let max = max_concurrent.clone();
            tasks.push(tokio::spawn(async move {
                locks
                    .with_lock("res", || async {
                        let now = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                        max.fetch_max(now, std::sync::atomic::Ordering::SeqCst);

                        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                        counter.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                    })
                    .await;
            }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        assert_eq!(max_concurrent.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}

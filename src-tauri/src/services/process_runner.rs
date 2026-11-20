#![allow(dead_code)]

use crate::errors::AppError;
use encoding_rs::IBM866;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Stream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk {
    pub stream: Stream,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

pub fn decode_output(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => {
            let (decoded, _, had_errors) = IBM866.decode(bytes);
            if had_errors {
                String::from_utf8_lossy(bytes).into_owned()
            } else {
                decoded.into_owned()
            }
        }
    }
}

pub async fn run(
    mut command: Command,
    timeout: Duration,
    cancel: CancellationToken,
    on_output: Option<mpsc::Sender<OutputChunk>>,
) -> Result<RunResult, AppError> {
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .kill_on_drop(true);

    let mut child = command.spawn().map_err(|e| {
        AppError::new(
            "PROCESS_SPAWN_FAILED",
            "Не удалось запустить процесс. Возможно, файл отсутствует или недоступен",
        )
        .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;
    let pid = child.id();

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_task = stream_reader(stdout, Stream::Stdout, on_output.clone());
    let stderr_task = stream_reader(stderr, Stream::Stderr, on_output);

    let timer = tokio::time::sleep(timeout);
    tokio::pin!(timer);

    let wait_result = tokio::select! {
        r = child.wait() => r,
        _ = &mut timer => {
            kill_tree(pid).await;
            let _ = child.wait().await;
            return Ok(RunResult { exit_code: None, stdout: String::new(), stderr: String::new(), timed_out: true, cancelled: false });
        }
        _ = cancel.cancelled() => {
            kill_tree(pid).await;
            let _ = child.wait().await;
            return Ok(RunResult { exit_code: None, stdout: String::new(), stderr: String::new(), timed_out: false, cancelled: true });
        }
    };

    let status = wait_result.map_err(|e| {
        AppError::new(
            "PROCESS_WAIT_FAILED",
            "Процесс завершился с системной ошибкой",
        )
        .with_details(serde_json::json!({ "error": e.to_string() }))
    })?;

    let (out, err) = tokio::join!(stdout_task, stderr_task);
    Ok(RunResult {
        exit_code: status.code(),
        stdout: out,
        stderr: err,
        timed_out: false,
        cancelled: false,
    })
}

async fn stream_reader(
    pipe: Option<impl AsyncReadExt + Unpin>,
    stream: Stream,
    on_output: Option<mpsc::Sender<OutputChunk>>,
) -> String {
    let Some(reader) = pipe else {
        return String::new();
    };
    let mut reader = BufReader::new(reader);
    let mut buffer = [0u8; 8192];
    let mut chunks: Vec<u8> = Vec::new();
    let mut collected: Vec<u8> = Vec::new();
    let mut since_flush = std::time::Instant::now();

    loop {
        let n = match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        chunks.extend_from_slice(&buffer[..n]);
        collected.extend_from_slice(&buffer[..n]);

        if let Some(tx) = &on_output {
            let should_flush =
                chunks.len() >= 512 || since_flush.elapsed() >= Duration::from_millis(250);
            if should_flush {
                let _ = tx
                    .send(OutputChunk {
                        stream,
                        text: decode_output(&chunks),
                    })
                    .await;
                chunks.clear();
                since_flush = std::time::Instant::now();
            }
        }
    }

    if let Some(tx) = &on_output {
        if !chunks.is_empty() {
            let _ = tx
                .send(OutputChunk {
                    stream,
                    text: decode_output(&chunks),
                })
                .await;
        }
    }
    decode_output(&collected)
}

async fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    let _ = tokio::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000)
        .output()
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8() {
        assert_eq!(decode_output("привет".as_bytes()), "привет");
    }

    #[test]
    fn decodes_cp866_when_not_utf8() {
        let bytes = [0xAF, 0xE0, 0xA8, 0xA2, 0xA5, 0xE2];
        assert_eq!(decode_output(&bytes), "привет");
    }

    #[test]
    fn uses_cp866_for_bytes_invalid_in_utf8_but_valid_in_cp866() {
        assert_eq!(decode_output(&[0x81, 0x81]), "ББ");
    }

    #[tokio::test]
    async fn captures_exit_code_and_output() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "echo привет"]);
        let result = run(cmd, Duration::from_secs(10), CancellationToken::new(), None)
            .await
            .unwrap();
        assert_eq!(result.exit_code, Some(0));
        assert!(
            result.stdout.contains("привет"),
            "stdout: {}",
            result.stdout
        );
    }

    #[tokio::test]
    async fn timeout_kills_long_process() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "ping -n 60 127.0.0.1 > nul"]);
        let started = std::time::Instant::now();
        let result = run(
            cmd,
            Duration::from_millis(300),
            CancellationToken::new(),
            None,
        )
        .await
        .unwrap();
        assert!(result.timed_out);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn cancellation_terminates_process() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "ping -n 60 127.0.0.1 > nul"]);
        let token = CancellationToken::new();
        let cancel_token = token.clone();
        let task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            cancel_token.cancel();
        });
        let result = run(cmd, Duration::from_secs(30), token, None)
            .await
            .unwrap();
        task.await.unwrap();
        assert!(result.cancelled);
    }

    #[tokio::test]
    async fn streams_output_chunks() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "echo line1 && echo line2"]);
        let (tx, rx) = mpsc::channel(64);
        let result = run(
            cmd,
            Duration::from_secs(10),
            CancellationToken::new(),
            Some(tx),
        )
        .await
        .unwrap();
        drop(rx);
        assert_eq!(result.exit_code, Some(0));

        assert!(result.stdout.contains("line1") && result.stdout.contains("line2"));
    }

    #[tokio::test]
    async fn spawn_failure_returns_app_error() {
        let cmd = Command::new("definitely-not-existing-binary-xyz");
        let err = run(cmd, Duration::from_secs(5), CancellationToken::new(), None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "PROCESS_SPAWN_FAILED");
    }
}

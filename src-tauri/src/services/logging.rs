use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LINES: usize = 5000;
const MAX_LINE_CHARS: usize = 600;

#[derive(Clone)]
pub struct LogHandle {
    path: PathBuf,
    file: Arc<Mutex<Option<File>>>,
}

static HANDLE: OnceLock<LogHandle> = OnceLock::new();

fn log_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|appdata| Path::new(&appdata).join("control").join("logs"))
        .unwrap_or_else(|_| std::env::temp_dir().join("control-logs"))
}

fn rotate(path: &Path) {
    let too_big = fs::metadata(path)
        .map(|m| m.len() > MAX_BYTES)
        .unwrap_or(false);
    if !too_big {
        return;
    }
    let previous = path.with_extension("log.1");
    let _ = fs::remove_file(&previous);
    let _ = fs::rename(path, previous);
}

fn open(path: &Path) -> Option<File> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok()?;
    }
    rotate(path);
    OpenOptions::new().create(true).append(true).open(path).ok()
}

pub fn init() -> LogHandle {
    let path = log_dir().join("control.log");
    let file = open(&path);
    let handle = LogHandle {
        path,
        file: Arc::new(Mutex::new(file)),
    };
    let _ = HANDLE.set(handle.clone());
    handle
}

pub fn handle() -> Option<&'static LogHandle> {
    HANDLE.get()
}

pub fn path() -> Option<PathBuf> {
    handle().map(|h| h.path.clone())
}

pub fn tail(lines: usize) -> Vec<String> {
    let Some(handle) = handle() else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(&handle.path) else {
        return Vec::new();
    };
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines.min(MAX_LINES));
    all[start..]
        .iter()
        .map(|line| {
            let trimmed: String = line.chars().take(MAX_LINE_CHARS).collect();
            trimmed
        })
        .collect()
}

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".into());
        let message = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "panic".to_string()
        };
        tracing::error!(target: "panic", location = %location, "необработанная паника: {message}");
        previous(info);
    }));
}

pub struct Tee<'a> {
    file: &'a Arc<Mutex<Option<File>>>,
    stderr: io::Stderr,
}

impl Write for Tee<'_> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let _ = self.stderr.write_all(buf);
        if let Ok(mut guard) = self.file.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.write_all(buf);
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let _ = self.stderr.flush();
        if let Ok(mut guard) = self.file.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.flush();
            }
        }
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogHandle {
    type Writer = Tee<'a>;

    fn make_writer(&'a self) -> Self::Writer {
        Tee {
            file: &self.file,
            stderr: io::stderr(),
        }
    }
}

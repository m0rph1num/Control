#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessEntry {
    pub pid: u32,
    pub path: Option<String>,
}

pub fn list(name: &str) -> Vec<ProcessEntry> {
    imp::find(name)
}

pub fn running(name: &str) -> bool {
    imp::running(name)
}

pub fn list_all_names() -> Vec<String> {
    imp::all_names()
}

#[cfg(windows)]
mod imp {
    use super::ProcessEntry;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStringExt;

    type Handle = *mut c_void;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            buffer: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    fn normalize(name: &str) -> String {
        let lower = name.to_lowercase();
        lower
            .strip_suffix(".exe")
            .map(str::to_string)
            .unwrap_or(lower)
    }

    fn exe_name(entry: &ProcessEntry32W) -> String {
        let len = entry
            .sz_exe_file
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(entry.sz_exe_file.len());
        normalize(&std::ffi::OsString::from_wide(&entry.sz_exe_file[..len]).to_string_lossy())
    }

    fn image_path(pid: u32) -> Option<String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut buffer = vec![0u16; 1024];
        let mut size = buffer.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size) };
        unsafe { CloseHandle(handle) };
        if ok == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..size as usize]))
    }

    pub fn running(name: &str) -> bool {
        let wanted = normalize(name);
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: ProcessEntry32W = unsafe { std::mem::zeroed() };
        entry.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;
        let mut found = false;
        let mut next = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
        while next {
            if exe_name(&entry) == wanted {
                found = true;
                break;
            }
            next = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        }
        unsafe { CloseHandle(snapshot) };
        found
    }

    pub fn find(name: &str) -> Vec<ProcessEntry> {
        let wanted = normalize(name);
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Vec::new();
        }
        let mut entry: ProcessEntry32W = unsafe { std::mem::zeroed() };
        entry.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;
        let mut found = Vec::new();
        let mut next = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
        while next {
            if exe_name(&entry) == wanted {
                found.push(ProcessEntry {
                    pid: entry.th32_process_id,
                    path: image_path(entry.th32_process_id),
                });
            }
            next = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        }
        unsafe { CloseHandle(snapshot) };
        found
    }

    pub fn all_names() -> Vec<String> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Vec::new();
        }
        let mut entry: ProcessEntry32W = unsafe { std::mem::zeroed() };
        entry.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;
        let mut names = Vec::new();
        let mut next = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
        while next {
            names.push(exe_name(&entry));
            next = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        }
        unsafe { CloseHandle(snapshot) };
        names
    }
}

#[cfg(not(windows))]
mod imp {
    use super::ProcessEntry;

    pub fn running(_name: &str) -> bool {
        false
    }

    pub fn find(_name: &str) -> Vec<ProcessEntry> {
        Vec::new()
    }

    pub fn all_names() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_process_is_not_found() {
        assert!(!running("control-missing-process-xyz"));
        assert!(list("control-missing-process-xyz").is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn finds_current_process_by_executable_name() {
        let exe = std::env::current_exe().expect("путь к исполняемому файлу");
        let name = exe
            .file_stem()
            .expect("имя исполняемого файла")
            .to_string_lossy()
            .to_string();
        let found = list(&name);
        assert!(
            found.iter().any(|entry| entry.pid == std::process::id()),
            "процесс {} ({name}) не найден среди {found:?}",
            std::process::id()
        );
    }
}

use std::path::{Path, PathBuf};

pub const APP_ID: &str = "dev.control.app";
pub const APP_NAME: &str = "Control";

const ICON_PNG: &[u8] = include_bytes!("../../icons/icon.png");
const ICON_ICO: &[u8] = include_bytes!("../../icons/icon.ico");
const ICON_BACKGROUND: &str = "FF323339";

fn cached(name: &str, bytes: &[u8]) -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    let dir = Path::new(&appdata).join("control");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(name);
    let stale = std::fs::read(&path).map_or(true, |cached| cached != bytes);
    if stale {
        std::fs::write(&path, bytes).ok()?;
    }
    Some(path)
}

fn icon_png() -> Option<PathBuf> {
    cached("notification.png", ICON_PNG)
}

fn icon_ico() -> Option<PathBuf> {
    cached("notification.ico", ICON_ICO)
}

#[cfg(windows)]
mod imp {
    use super::{icon_ico, icon_png, APP_ID, APP_NAME, ICON_BACKGROUND};
    use std::path::{Path, PathBuf};
    use std::sync::Once;
    use tauri_winrt_notification::{IconCrop, Toast};
    use windows::core::{Interface, GUID, HSTRING, PWSTR};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::System::Com::StructuredStorage::{
        PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    static IDENTITY: Once = Once::new();

    const APP_USER_MODEL_ID_KEY: GUID = GUID::from_u128(0x9F4C_2855_9F79_4B39_A8D0_E1D4_2DE1_D5F3);

    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }

    fn set_process_app_id() {
        let mut wide: Vec<u16> = APP_ID.encode_utf16().collect();
        wide.push(0);
        unsafe {
            SetCurrentProcessExplicitAppUserModelID(wide.as_ptr());
        }
    }

    fn register_app_id(icon: &Path) {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let Ok((key, _)) = hkcu.create_subkey(format!(r"Software\Classes\AppUserModelId\{APP_ID}"))
        else {
            return;
        };
        let _ = key.set_value("DisplayName", &APP_NAME);
        let _ = key.set_value("IconUri", &icon.display().to_string());
        let _ = key.set_value("IconBackgroundColor", &ICON_BACKGROUND);
    }

    fn start_menu_dir() -> Option<PathBuf> {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            Path::new(&appdata)
                .join(r"Microsoft\Windows\Start Menu\Programs")
                .join(format!("{APP_NAME}.lnk")),
        )
    }

    fn marker_path() -> Option<PathBuf> {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            Path::new(&appdata)
                .join("control")
                .join("shortcut-target.txt"),
        )
    }

    unsafe fn build_shortcut(exe: &Path, icon: &Path, link: &Path) -> windows::core::Result<()> {
        let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        shell.SetPath(&HSTRING::from(exe.to_string_lossy().as_ref()))?;
        if let Some(dir) = exe.parent() {
            shell.SetWorkingDirectory(&HSTRING::from(dir.to_string_lossy().as_ref()))?;
        }
        shell.SetDescription(&HSTRING::from(APP_NAME))?;
        shell.SetIconLocation(&HSTRING::from(icon.to_string_lossy().as_ref()), 0)?;

        let store: IPropertyStore = shell.cast()?;
        let key = PROPERTYKEY {
            fmtid: APP_USER_MODEL_ID_KEY,
            pid: 5,
        };
        let mut app_id: Vec<u16> = APP_ID.encode_utf16().collect();
        app_id.push(0);
        let value = PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_LPWSTR,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        pwszVal: PWSTR(app_id.as_mut_ptr()),
                    },
                }),
            },
        };
        store.SetValue(&key, &value)?;
        store.Commit()?;

        let file: IPersistFile = shell.cast()?;
        let result = file.Save(&HSTRING::from(link.to_string_lossy().as_ref()), true);
        std::mem::forget(file);
        std::mem::forget(store);
        std::mem::forget(shell);
        std::mem::forget(value);
        std::mem::forget(app_id);
        result
    }

    fn write_shortcut() -> bool {
        let (Ok(exe), Some(link)) = (std::env::current_exe(), start_menu_dir()) else {
            return false;
        };
        let Some(icon) = icon_ico() else {
            return false;
        };
        if let Some(dir) = link.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        let saved = unsafe { build_shortcut(&exe, &icon, &link) }.is_ok();
        if saved {
            if let Some(marker) = marker_path() {
                let _ = std::fs::write(marker, exe.to_string_lossy().as_bytes());
            }
        }
        if init.is_ok() {
            unsafe { CoUninitialize() };
        }
        saved
    }

    pub fn ensure_identity() {
        IDENTITY.call_once(|| {
            set_process_app_id();
            if let Some(icon) = icon_ico().or_else(icon_png) {
                register_app_id(&icon);
            }
        });
    }

    pub fn spawn_shortcut_helper() {
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let current = exe.to_string_lossy().to_string();
        if marker_path()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .as_deref()
            == Some(current.as_str())
        {
            return;
        }
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new(exe)
            .arg("--write-shortcut")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    pub fn write_shortcut_helper() -> bool {
        write_shortcut()
    }

    pub fn show(title: &str, body: &str) -> Result<(), String> {
        ensure_identity();
        let mut toast = Toast::new(APP_ID).title(title).text1(body);
        if let Some(icon) = icon_png() {
            toast = toast.icon(&icon, IconCrop::Square, APP_NAME);
        }
        toast.show().map_err(|error| error.to_string())
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn ensure_identity() {}

    pub fn spawn_shortcut_helper() {}

    pub fn write_shortcut_helper() -> bool {
        false
    }

    pub fn show(_title: &str, _body: &str) -> Result<(), String> {
        Ok(())
    }
}

pub use imp::{ensure_identity, show, spawn_shortcut_helper, write_shortcut_helper};

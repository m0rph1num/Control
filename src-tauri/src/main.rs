#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--write-shortcut") {
        let ok = control_lib::write_shortcut_helper();
        std::process::exit(if ok { 0 } else { 1 });
    }
    control_lib::run()
}

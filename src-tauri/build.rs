fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=TARGET={target}");

    // Windows gives the main thread 1 MB by default, which is not enough for the
    // WebView2 event dispatch chain in optimized builds. Match the 8 MB that
    // Rust uses on other platforms.
    if target.contains("msvc") {
        println!("cargo:rustc-link-arg=/STACK:8388608");
    }

    // tauri-build validates externalBin paths during the build script. The real
    // helper is produced by `npm run bundle:helper`; create a placeholder so
    // plain `cargo check`/`clippy`/`test` work without a prior bundle step.
    let helper = format!("control-elevate-{target}.exe");
    if !std::path::Path::new(&helper).exists() {
        std::fs::write(&helper, b"").expect("cannot create external bin placeholder");
    }

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    )
    .expect("tauri-build failed");

    embed_resource::compile_for("control.rc", ["control"], embed_resource::NONE)
        .manifest_required()
        .unwrap();
    embed_resource::compile_for(
        "control-elevate.rc",
        ["control-elevate"],
        embed_resource::NONE,
    )
    .manifest_required()
    .unwrap();
}

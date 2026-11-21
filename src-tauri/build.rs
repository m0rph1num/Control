fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=TARGET={target}");

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

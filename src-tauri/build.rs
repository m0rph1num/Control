fn main() {
    println!(
        "cargo:rustc-env=TARGET={}",
        std::env::var("TARGET").unwrap_or_default()
    );

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

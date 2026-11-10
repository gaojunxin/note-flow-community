fn main() {
    // 原生启动卡在主WebView创建之前显示；macOS控件由AppKit持有。
    println!("cargo:rerun-if-changed=src/native_startup_macos.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/native_startup_macos.m")
            .flag("-fobjc-arc")
            .compile("note_flow_native_startup");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
    tauri_build::build()
}

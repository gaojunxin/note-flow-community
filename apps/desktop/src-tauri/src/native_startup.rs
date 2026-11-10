//! 在应用主WebView创建之前显示原生启动控件。
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

pub const LABEL: &str = "native-startup";
pub struct NativeStartup {
    foreground: AtomicBool,
    ready: AtomicBool,
}

pub fn begin(app: &tauri::AppHandle) -> tauri::Result<()> {
    let foreground = !std::env::args().any(|value| value == "--hidden");
    app.manage(NativeStartup {
        foreground: AtomicBool::new(foreground),
        ready: AtomicBool::new(false),
    });
    if !foreground {
        return Ok(());
    }
    show_native(app)
}

fn show_native(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = tauri::WindowBuilder::new(app, LABEL)
        .title("迹语 · 正在启动")
        .inner_size(360.0, 200.0)
        .decorations(false)
        .background_color(tauri::window::Color(248, 251, 249, 255))
        .resizable(false)
        .maximizable(false)
        .center()
        .build()?;
    if let Some(icon) = app.default_window_icon().cloned() {
        window.set_icon(icon)?;
    }
    populate(&window)?;
    window.show()?;
    Ok(())
}

pub fn present(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<NativeStartup>() else {
        return;
    };
    state.foreground.store(true, Ordering::SeqCst);
    if !state.ready.load(Ordering::SeqCst) {
        if let Some(window) = app.get_window(LABEL) {
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            let _ = show_native(app);
        }
    } else if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

pub fn create_main(app: &tauri::AppHandle) -> tauri::Result<()> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|value| value.label == "main")
        .cloned()
        .expect("main window configuration");
    config.visible = false;
    let main = tauri::WebviewWindowBuilder::from_config(app, &config)?.build()?;
    if let Some(icon) = app.default_window_icon().cloned() {
        main.set_icon(icon)?;
    }
    main.set_skip_taskbar(false)?;
    Ok(())
}

pub fn complete(app: &tauri::AppHandle) -> tauri::Result<()> {
    let state = app.state::<NativeStartup>();
    if state.ready.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if state.foreground.load(Ordering::SeqCst) {
        if let Some(main) = app.get_webview_window("main") {
            main.show()?;
            main.set_focus()?;
        }
    }
    if let Some(splash) = app.get_window(LABEL) {
        splash.destroy()?;
    }
    Ok(())
}

pub fn message(app: &tauri::AppHandle, text: &str) {
    if let Some(window) = app.get_window(LABEL) {
        let _ = window.set_title(text);
        let owned = text.to_string();
        let handle = window.clone();
        let _ = window.run_on_main_thread(move || set_message(&handle, &owned));
    }
}

#[cfg(target_os = "linux")]
fn populate(window: &tauri::Window) -> tauri::Result<()> {
    use gtk::prelude::*;
    let native = window.gtk_window()?;
    native.set_widget_name("native-startup-card");
    let css = gtk::CssProvider::new();
    css.load_from_data(include_bytes!("native_startup.css"))
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    gtk::StyleContext::add_provider_for_screen(
        &gtk::prelude::WidgetExt::screen(&native).expect("native startup screen"),
        &css,
        gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
    let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
    root.set_widget_name("native-startup-layout");
    root.set_margin_start(36);
    root.set_margin_end(36);
    root.set_margin_top(36);
    root.set_margin_bottom(32);
    let brand = gtk::Box::new(gtk::Orientation::Horizontal, 14);
    brand.set_halign(gtk::Align::Start);
    if let Some(icon) = window.app_handle().default_window_icon() {
        let pixels = gtk::gdk_pixbuf::Pixbuf::from_mut_slice(
            icon.rgba().to_vec(),
            gtk::gdk_pixbuf::Colorspace::Rgb,
            true,
            8,
            icon.width() as i32,
            icon.height() as i32,
            icon.width() as i32 * 4,
        );
        if let Some(scaled) = pixels.scale_simple(48, 48, gtk::gdk_pixbuf::InterpType::Bilinear) {
            brand.pack_start(&gtk::Image::from_pixbuf(Some(&scaled)), false, false, 0);
        }
    }
    let title = gtk::Label::new(Some("迹语"));
    title.set_widget_name("native-startup-title");
    brand.pack_start(&title, false, false, 0);
    root.pack_start(&brand, false, false, 0);
    let status = gtk::Label::new(Some("正在启动…"));
    status.set_widget_name("native-startup-message");
    status.set_xalign(0.0);
    status.set_margin_top(24);
    root.pack_start(&status, false, false, 0);
    let progress = gtk::ProgressBar::new();
    progress.set_widget_name("native-startup-progress");
    progress.set_margin_top(12);
    progress.set_pulse_step(0.15);
    progress.pulse();
    let weak = progress.downgrade();
    gtk::glib::timeout_add_local(std::time::Duration::from_millis(80), move || {
        if let Some(progress) = weak.upgrade() {
            progress.pulse();
            gtk::glib::ControlFlow::Continue
        } else {
            gtk::glib::ControlFlow::Break
        }
    });
    root.pack_start(&progress, false, false, 0);
    window.default_vbox()?.pack_start(&root, true, true, 0);
    native.show_all();
    // Paint native widgets before WebKit initialization can occupy the UI thread.
    while gtk::events_pending() {
        gtk::main_iteration_do(false);
    }
    Ok(())
}
#[cfg(target_os = "linux")]
fn set_message(window: &tauri::Window, text: &str) {
    use gtk::prelude::*;
    if let Ok(root) = window.default_vbox() {
        for child in root.children() {
            if let Ok(group) = child.downcast::<gtk::Box>() {
                for widget in group.children() {
                    if widget.widget_name() == "native-startup-message" {
                        if let Ok(label) = widget.downcast::<gtk::Label>() {
                            label.set_text(text);
                        }
                    }
                }
            }
        }
    }
}
#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
// Keep native label backgrounds and colors aligned with the card, then release
// the owned brush when Windows destroys the startup window.
#[cfg(target_os = "windows")]
unsafe extern "system" fn card_colors(
    hwnd: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
    id: usize,
    brush: usize,
) -> isize {
    use windows_sys::Win32::{
        Graphics::Gdi::*,
        UI::{Shell::*, WindowsAndMessaging::*},
    };
    if message == WM_CTLCOLORSTATIC {
        let dc = wparam as HDC;
        SetBkMode(dc, TRANSPARENT as i32);
        let color = if GetDlgCtrlID(lparam as _) == 1000 {
            0x00323e17
        } else {
            0x00737b68
        };
        SetTextColor(dc, color);
        return brush as isize;
    }
    if message == WM_NCDESTROY {
        RemoveWindowSubclass(hwnd, Some(card_colors), id);
        DeleteObject(brush as _);
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}
#[cfg(target_os = "windows")]
fn populate(window: &tauri::Window) -> tauri::Result<()> {
    use windows_sys::Win32::{
        Graphics::Gdi::{
            CreateFontW, DeleteObject, UpdateWindow, CLEARTYPE_QUALITY, DEFAULT_CHARSET,
        },
        UI::{Controls::*, WindowsAndMessaging::*},
    };
    let hwnd = window.hwnd()?.0 as windows_sys::Win32::Foundation::HWND;
    let scale = window.scale_factor()?;
    let px = |value: f64| (value * scale).round() as i32;
    unsafe {
        let brush = windows_sys::Win32::Graphics::Gdi::CreateSolidBrush(0x00f9fbf8);
        if !brush.is_null()
            && windows_sys::Win32::UI::Shell::SetWindowSubclass(
                hwnd,
                Some(card_colors),
                1,
                brush as usize,
            ) == 0
        {
            DeleteObject(brush as _);
        }
        let init = INITCOMMONCONTROLSEX {
            dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32,
            dwICC: ICC_PROGRESS_CLASS,
        };
        InitCommonControlsEx(&init);
        let image = CreateWindowExW(
            0,
            wide("STATIC").as_ptr(),
            std::ptr::null(),
            WS_CHILD
                | WS_VISIBLE
                | windows_sys::Win32::System::SystemServices::SS_ICON
                | windows_sys::Win32::System::SystemServices::SS_REALSIZECONTROL,
            px(36.0),
            px(36.0),
            px(48.0),
            px(48.0),
            hwnd,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        let icon = SendMessageW(hwnd, WM_GETICON, ICON_BIG as usize, 0);
        if icon != 0 {
            SendMessageW(image, STM_SETICON, icon as usize, 0);
        }
        let mut fonts = Vec::new();
        for (id, text, x, y, width, height, size, weight) in [
            (1000, "迹语", 98.0, 42.0, 226.0, 40.0, 27.0, 600),
            (1001, "正在启动…", 36.0, 108.0, 288.0, 28.0, 14.0, 400),
        ] {
            let label = CreateWindowExW(
                0,
                wide("STATIC").as_ptr(),
                wide(text).as_ptr(),
                WS_CHILD | WS_VISIBLE,
                px(x),
                px(y),
                px(width),
                px(height),
                hwnd,
                id as _,
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            let font = CreateFontW(
                -px(size),
                0,
                0,
                0,
                weight,
                0,
                0,
                0,
                DEFAULT_CHARSET as u32,
                0,
                0,
                CLEARTYPE_QUALITY as u32,
                0,
                wide("Microsoft YaHei UI").as_ptr(),
            );
            if !font.is_null() {
                SendMessageW(label, WM_SETFONT, font as usize, 1);
                fonts.push(font as usize);
            }
        }
        // Fonts must remain alive while the STATIC controls use them.
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                for font in &fonts {
                    DeleteObject(*font as _);
                }
            }
        });
        let progress = CreateWindowExW(
            0,
            PROGRESS_CLASSW,
            std::ptr::null(),
            WS_CHILD | WS_VISIBLE | PBS_MARQUEE,
            px(36.0),
            px(148.0),
            px(288.0),
            px(4.0),
            hwnd,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        SendMessageW(progress, PBM_SETMARQUEE, 1, 30);
        UpdateWindow(hwnd);
    }
    Ok(())
}
#[cfg(target_os = "windows")]
fn set_message(window: &tauri::Window, text: &str) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::SetDlgItemTextW(
                hwnd.0 as _,
                1001,
                wide(text).as_ptr(),
            );
        }
    }
}
#[cfg(target_os = "macos")]
extern "C" {
    fn note_flow_startup_populate(window: *mut std::ffi::c_void);
    fn note_flow_startup_message(window: *mut std::ffi::c_void, text: *const std::ffi::c_char);
}

#[cfg(target_os = "macos")]
fn populate(window: &tauri::Window) -> tauri::Result<()> {
    // setup创建窗口时已在主线程，AppKit子控件的生命周期由窗口管理。
    unsafe { note_flow_startup_populate(window.ns_window()?) };
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_message(window: &tauri::Window, text: &str) {
    // 调用方通过run_on_main_thread更新，临时CString存活至原生调用返回。
    if let (Ok(handle), Ok(text)) = (window.ns_window(), std::ffi::CString::new(text)) {
        unsafe { note_flow_startup_message(handle, text.as_ptr()) };
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn populate(_: &tauri::Window) -> tauri::Result<()> {
    Ok(())
}
#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn set_message(_: &tauri::Window, _: &str) {}

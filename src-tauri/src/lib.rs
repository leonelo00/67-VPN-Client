mod core;

use core::{
    clear_logs, connect_vpn, disconnect_vpn, download_and_run_update, fetch_subscription, get_logs, get_traffic_stats,
    check_github_update, is_core_running, list_installed_apps, list_running_processes, load_state, pick_exe_file,
    ping_icmp, ping_server, ping_url, read_clipboard, restart_as_admin, save_state, send_notification, set_autostart,
    set_kill_switch, set_log_limit, set_minimize_to_tray, set_system_proxy, CoreManager, SharedCore,
};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

#[derive(serde::Deserialize)]
pub struct TrayServerItem {
    pub id: String,
    pub name: String,
}

fn build_tray_menu(
    app: &AppHandle,
    connected: bool,
    servers: &[TrayServerItem],
    selected_id: &str,
) -> tauri::Result<Menu<tauri::Wry>> {
    let toggle_label = if connected {
        "Отключиться"
    } else {
        "Подключиться"
    };
    let toggle_item = MenuItem::with_id(app, "toggle_connect", toggle_label, true, None::<&str>)?;
    let reconnect_item =
        MenuItem::with_id(app, "reconnect", "Переподключиться", connected, None::<&str>)?;

    let mut srv_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    for s in servers {
        let prefix = if s.id == selected_id { "● " } else { "   " };
        let item = MenuItem::with_id(
            app,
            format!("srv:{}", s.id),
            format!("{}{}", prefix, s.name),
            true,
            None::<&str>,
        )?;
        srv_items.push(item);
    }
    let srv_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = srv_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let servers_submenu = Submenu::with_items(app, "Сервера", true, &srv_refs)?;

    let sep = PredefinedMenuItem::separator(app)?;
    let show_item = MenuItem::with_id(app, "show", "Показать окно", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &toggle_item,
            &reconnect_item,
            &servers_submenu,
            &sep,
            &show_item,
            &quit_item,
        ],
    )
}

#[tauri::command]
fn update_tray_menu(
    app: AppHandle,
    connected: bool,
    servers: Vec<TrayServerItem>,
    selected_id: String,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let menu = build_tray_menu(&app, connected, &servers, &selected_id)
            .map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let core_state: SharedCore = Arc::new(Mutex::new(CoreManager::new()));
    let core_for_exit = Arc::clone(&core_state);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(core_state)
        .setup(|app| {
            let _ = set_kill_switch(false);
            let menu = build_tray_menu(app.handle(), false, &[], "")?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("67 VPN")
                .on_menu_event(move |app, event| {
                    let id = event.id.as_ref();
                    if id == "show" {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    } else if id == "quit" {
                        app.exit(0);
                    } else if id == "toggle_connect" || id == "reconnect" || id.starts_with("srv:") {
                        let _ = app.emit("tray-action", id.to_string());
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            #[cfg(target_os = "windows")]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.with_webview(|wv| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows_core::Interface;
                    if let Ok(core) = wv.controller().CoreWebView2() {
                        if let Ok(settings) = core.Settings() {
                            if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
                                let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
                            }
                            let _ = settings.SetAreDefaultContextMenusEnabled(false);
                            let _ = settings.SetAreDevToolsEnabled(false);
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let min_to_tray = window
                    .try_state::<SharedCore>()
                    .and_then(|s| s.lock().ok().map(|m| m.minimize_to_tray))
                    .unwrap_or(true);
                if min_to_tray && window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ping_server,
            ping_url,
            ping_icmp,
            connect_vpn,
            disconnect_vpn,
            get_logs,
            set_system_proxy,
            fetch_subscription,
            read_clipboard,
            save_state,
            load_state,
            update_tray_menu,
            get_traffic_stats,
            clear_logs,
            set_autostart,
            list_running_processes,
            list_installed_apps,
            pick_exe_file,
            is_core_running,
            set_kill_switch,
            set_log_limit,
            set_minimize_to_tray,
            send_notification,
            restart_as_admin,
            check_github_update,
            download_and_run_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = set_system_proxy(false, 10808);
                let _ = set_kill_switch(false);
                if let Ok(mut mgr) = core_for_exit.lock() {
                    if let Some(mut child) = mgr.child.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    if let Some(mut aux) = mgr.aux_child.take() {
                        let _ = aux.kill();
                        let _ = aux.wait();
                    }
                }
            }
        });
}

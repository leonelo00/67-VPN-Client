use super::resolve_binary_path;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;


#[tauri::command]
pub fn set_system_proxy(enable: bool, port: u16) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let settings = hkcu
            .open_subkey_with_flags(
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                KEY_WRITE,
            )
            .map_err(|e| format!("Ошибка открытия реестра: {}", e))?;

        if enable {
            settings
                .set_value("ProxyEnable", &1u32)
                .map_err(|e| e.to_string())?;
            settings
                .set_value("ProxyServer", &format!("127.0.0.1:{}", port))
                .map_err(|e| e.to_string())?;
        } else {
            settings
                .set_value("ProxyEnable", &0u32)
                .map_err(|e| e.to_string())?;
        }

        // Notify Windows / WinINet immediately about proxy changes
        #[link(name = "wininet")]
        unsafe extern "system" {
            fn InternetSetOptionW(
                hinternet: *mut std::ffi::c_void,
                dwoption: u32,
                lpbuffer: *mut std::ffi::c_void,
                dwbufferlength: u32,
            ) -> i32;
        }
        unsafe {
            InternetSetOptionW(std::ptr::null_mut(), 39, std::ptr::null_mut(), 0); // INTERNET_OPTION_SETTINGS_CHANGED
            InternetSetOptionW(std::ptr::null_mut(), 37, std::ptr::null_mut(), 0); // INTERNET_OPTION_REFRESH
        }
    }
    Ok(())
}

#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", "Get-Clipboard"])
            .creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| e.to_string())?;
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    #[cfg(not(target_os = "windows"))]
    Err("Unsupported OS".to_string())
}

fn state_file_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("67VPN");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("state.json")
}

#[tauri::command]
pub fn save_state(data: String) -> Result<(), String> {
    std::fs::write(state_file_path(), data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_state() -> Result<String, String> {
    let path = state_file_path();
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("schtasks");
        cmd.creation_flags(0x08000000);
        if enable {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let tr = format!("\"{}\"", exe.display());
            cmd.args([
                "/Create",
                "/TN",
                "67VPN",
                "/TR",
                &tr,
                "/SC",
                "ONLOGON",
                "/RL",
                "HIGHEST",
                "/F",
            ]);
        } else {
            cmd.args(["/Delete", "/TN", "67VPN", "/F"]);
        }
        let output = cmd.output().map_err(|e| e.to_string())?;
        if !output.status.success() && enable {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }
    Ok(())
}



#[derive(serde::Serialize)]
pub struct ProcessItem {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub async fn list_running_processes() -> Result<Vec<ProcessItem>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("powershell");
            cmd.args([
                "-NoProfile",
                "-Command",
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Where-Object { $_.Path } | Select-Object -Unique Name, Path | ConvertTo-Json -Compress",
            ])
            .creation_flags(0x08000000);
            let output = cmd.output().map_err(|e| e.to_string())?;
            let text = String::from_utf8_lossy(&output.stdout);
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(Vec::new());
            }
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
                let mut res = Vec::new();
                for item in arr {
                    let name = item.get("Name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let path = item.get("Path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if !name.is_empty() && !path.is_empty() {
                        res.push(ProcessItem {
                            name: format!("{}.exe", name),
                            path,
                        });
                    }
                }
                res.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
                return Ok(res);
            }
        }
        Ok(Vec::new())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pick_exe_file() -> Result<Option<ProcessItem>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-STA",
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Executable (*.exe)|*.exe'; if ($d.ShowDialog() -eq 'OK') { $d.FileName }",
        ])
        .creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| e.to_string())?;
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            let name = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("app.exe")
                .to_string();
            return Ok(Some(ProcessItem { name, path }));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn list_installed_apps() -> Result<Vec<ProcessItem>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("powershell");
            cmd.args([
                "-NoProfile",
                "-Command",
                r#"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $sh = New-Object -ComObject WScript.Shell; $dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"); $res = @(); foreach ($d in $dirs) { if (Test-Path $d) { Get-ChildItem -Path $d -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $t = $sh.CreateShortcut($_.FullName).TargetPath; if ($t -and $t.EndsWith('.exe') -and (Test-Path $t)) { $res += [PSCustomObject]@{ Name = $_.BaseName; Path = $t } } } } }; $res | Sort-Object Name -Unique | ConvertTo-Json -Compress"#,
            ])
            .creation_flags(0x08000000);
            let output = cmd.output().map_err(|e| e.to_string())?;
            let text = String::from_utf8_lossy(&output.stdout);
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(Vec::new());
            }
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
                let mut res = Vec::new();
                for item in arr {
                    let name = item.get("Name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let path = item.get("Path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if !name.is_empty() && !path.is_empty() {
                        res.push(ProcessItem { name, path });
                    }
                }
                return Ok(res);
            }
        }
        Ok(Vec::new())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_kill_switch(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let delete_rule = |name: &str| {
            let mut cmd = Command::new("netsh");
            cmd.creation_flags(0x08000000);
            cmd.args(["advfirewall", "firewall", "delete", "rule", &format!("name={}", name)]);
            let _ = cmd.output();
        };
        delete_rule("67VPN_KillSwitch");
        delete_rule("67VPN_KillSwitch_AllowLoopback");
        delete_rule("67VPN_KillSwitch_AllowXray");
        delete_rule("67VPN_KillSwitch_AllowSingBox");

        if enable {
            let mut lo_cmd = Command::new("netsh");
            lo_cmd.creation_flags(0x08000000);
            lo_cmd.args([
                "advfirewall", "firewall", "add", "rule",
                "name=67VPN_KillSwitch_AllowLoopback", "dir=out", "action=allow",
                "remoteip=127.0.0.1", "enable=yes",
            ]);
            let _ = lo_cmd.output();

            for (rule_name, core_name) in [
                ("67VPN_KillSwitch_AllowXray", "xray"),
                ("67VPN_KillSwitch_AllowSingBox", "sing-box"),
            ] {
                if let Ok(bin) = resolve_binary_path(core_name) {
                    let mut allow_cmd = Command::new("netsh");
                    allow_cmd.creation_flags(0x08000000);
                    allow_cmd.args([
                        "advfirewall", "firewall", "add", "rule",
                        &format!("name={}", rule_name),
                        "dir=out", "action=allow",
                        &format!("program={}", bin.display()),
                        "enable=yes",
                    ]);
                    let _ = allow_cmd.output();
                }
            }

            let mut policy_cmd = Command::new("netsh");
            policy_cmd.creation_flags(0x08000000);
            policy_cmd.args([
                "advfirewall", "set", "allprofiles", "firewallpolicy",
                "blockinbound,blockoutbound",
            ]);
            let _ = policy_cmd.output();
        } else {
            let mut policy_cmd = Command::new("netsh");
            policy_cmd.creation_flags(0x08000000);
            policy_cmd.args([
                "advfirewall", "set", "allprofiles", "firewallpolicy",
                "blockinbound,allowoutbound",
            ]);
            let _ = policy_cmd.output();
        }
    }
    Ok(())
}




#[tauri::command]
pub async fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    style: Option<String>,
) -> Result<(), String> {
    let mode = style.unwrap_or_else(|| "custom".to_string());
    if mode == "system" {
        return tauri::async_runtime::spawn_blocking(move || {
            #[cfg(target_os = "windows")]
            {
                let safe_title = title.replace('\'', "''").replace('"', "");
                let safe_body = body.replace('\'', "''").replace('"', "");
                let script = format!(
                    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $n = $t.GetElementsByTagName('text'); $n.Item(0).AppendChild($t.CreateTextNode('{}')) | Out-Null; $n.Item(1).AppendChild($t.CreateTextNode('{}')) | Out-Null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('67 VPN').Show([Windows.UI.Notifications.ToastNotification]::new($t))",
                    safe_title, safe_body
                );
                let mut cmd = Command::new("powershell");
                cmd.args(["-NoProfile", "-Command", &script])
                    .creation_flags(0x08000000);
                let _ = cmd.output();
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
    if let Some(win) = app.get_webview_window("notify") {
        let _ = win.show();
        let _ = app.emit_to("notify", "notify-data", serde_json::json!({ "title": title, "body": body }));
        return Ok(());
    }

    let url = WebviewUrl::App("index.html?notify=1".into());
    if let Ok(win) = WebviewWindowBuilder::new(&app, "notify", url)
        .title("67 VPN Notification")
        .inner_size(340.0, 88.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .build()
    {
        if let Ok(Some(monitor)) = win.primary_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let w = (340.0 * scale) as i32;
            let h = (88.0 * scale) as i32;
            let x = size.width as i32 - w - (18.0 * scale) as i32;
            let y = size.height as i32 - h - (56.0 * scale) as i32;
            let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        }
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            let _ = app_clone.emit_to(
                "notify",
                "notify-data",
                serde_json::json!({ "title": title, "body": body }),
            );
        });
    }
    Ok(())
}




#[tauri::command]
pub fn is_admin() -> bool {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "shell32")]
        unsafe extern "system" {
            fn IsUserAnAdmin() -> i32;
        }
        return unsafe { IsUserAnAdmin() != 0 };
    }
    #[cfg(not(target_os = "windows"))]
    true
}

#[tauri::command]
pub fn restart_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-Command",
            &format!("Start-Process -FilePath '{}' -Verb RunAs", exe.display()),
        ])
        .creation_flags(0x08000000);
        cmd.spawn().map_err(|e| format!("Не удалось перезапустить: {}", e))?;
        app.exit(0);
    }
    Ok(())
}




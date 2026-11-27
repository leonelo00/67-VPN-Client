use super::{assign_child_to_job, resolve_binary_path, set_job_kill_on_close, SharedCore};
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[tauri::command]
pub fn connect_vpn(
    state: tauri::State<'_, SharedCore>,
    core: String,
    config_json: String,
    aux_core: Option<String>,
    aux_config_json: Option<String>,
    kill_on_exit: Option<bool>,
) -> Result<String, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;

    if let Some(mut old_child) = manager.child.take() {
        let _ = old_child.kill();
        let _ = old_child.wait();
    }
    if let Some(mut old_aux) = manager.aux_child.take() {
        let _ = old_aux.kill();
        let _ = old_aux.wait();
    }

    #[cfg(target_os = "windows")]
    {
        let mut kill_cmd = Command::new("taskkill");
        kill_cmd.args(["/F", "/IM", "sing-box.exe", "/IM", "xray.exe"])
            .creation_flags(0x08000000);
        let _ = kill_cmd.output();
    }

    let bin_path = resolve_binary_path(&core)?;
    let config_path = std::env::temp_dir().join("67vpn_config.json");
    std::fs::write(&config_path, config_json)
        .map_err(|e| format!("Не удалось записать конфиг: {}", e))?;

    let mut cmd = Command::new(&bin_path);
    cmd.args(["run", "-c", config_path.to_str().unwrap_or("")])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Ошибка запуска {}: {}", core, e))?;
    let should_kill = kill_on_exit.unwrap_or(true);
    manager.kill_on_exit = should_kill;
    #[cfg(target_os = "windows")]
    {
        set_job_kill_on_close(manager.job_handle, should_kill);
        assign_child_to_job(manager.job_handle, &child);
    }

    std::thread::sleep(Duration::from_millis(350));
    if let Ok(Some(status)) = child.try_wait() {
        let mut err_out = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            use std::io::Read;
            let _ = stderr.read_to_string(&mut err_out);
        }
        let msg = if err_out.trim().is_empty() {
            format!("Ядро {} сразу завершилось с кодом {}", core, status)
        } else {
            format!("Ядро {} завершилось ({}): {}", core, status, err_out.trim())
        };
        manager.push_log(format!("[67VPN] {}", msg));
        return Err(msg);
    }

    manager.push_log(format!("[67VPN] Запущено ядро: {} ({})", core, bin_path.display()));

    if let Some(stdout) = child.stdout.take() {
        let state_clone = Arc::clone(state.inner());
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut mgr) = state_clone.lock() {
                    mgr.push_log(line);
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let state_clone = Arc::clone(state.inner());
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut mgr) = state_clone.lock() {
                    mgr.push_log(line);
                }
            }
        });
    }

    manager.child = Some(child);
    manager.active_core = Some(core.clone());
    manager.last_traffic = (0, 0);

    if let (Some(a_core), Some(a_cfg)) = (aux_core, aux_config_json) {
        let a_bin = resolve_binary_path(&a_core)?;
        let a_cfg_path = std::env::temp_dir().join("67vpn_aux_config.json");
        std::fs::write(&a_cfg_path, a_cfg).map_err(|e| e.to_string())?;
        let mut a_cmd = Command::new(&a_bin);
        a_cmd
            .args(["run", "-c", a_cfg_path.to_str().unwrap_or("")])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        a_cmd.creation_flags(0x08000000);
        let mut a_child = a_cmd
            .spawn()
            .map_err(|e| format!("Ошибка запуска {}: {}", a_core, e))?;
        #[cfg(target_os = "windows")]
        assign_child_to_job(manager.job_handle, &a_child);
        std::thread::sleep(Duration::from_millis(350));
        if let Ok(Some(status)) = a_child.try_wait() {
            let mut err_out = String::new();
            if let Some(mut stderr) = a_child.stderr.take() {
                use std::io::Read;
                let _ = stderr.read_to_string(&mut err_out);
            }
            if let Some(mut main_child) = manager.child.take() {
                let _ = main_child.kill();
                let _ = main_child.wait();
            }
            manager.active_core = None;
            let msg = if err_out.trim().is_empty() {
                format!("Ядро {} завершилось с кодом {}", a_core, status)
            } else {
                format!("Ядро {} завершилось ({}): {}", a_core, status, err_out.trim())
            };
            manager.push_log(format!("[67VPN] {}", msg));
            return Err(msg);
        }
        manager.push_log(format!("[67VPN] Запущен TUN-мост: {}", a_core));

        if let Some(a_stdout) = a_child.stdout.take() {
            let state_clone = Arc::clone(state.inner());
            let tag = a_core.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(a_stdout);
                for line in reader.lines().map_while(Result::ok) {
                    if let Ok(mut mgr) = state_clone.lock() {
                        mgr.push_log(format!("[{}] {}", tag, line));
                    }
                }
            });
        }

        if let Some(a_stderr) = a_child.stderr.take() {
            let state_clone = Arc::clone(state.inner());
            let tag = a_core.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(a_stderr);
                for line in reader.lines().map_while(Result::ok) {
                    if let Ok(mut mgr) = state_clone.lock() {
                        mgr.push_log(format!("[{}] {}", tag, line));
                    }
                }
            });
        }

        manager.aux_child = Some(a_child);
    }

    if core == "sing-box" || manager.aux_child.is_some() {
        let state_clone = Arc::clone(state.inner());
        std::thread::spawn(move || {
            use std::io::Write;
            let mut stream_opt = None;
            for _ in 0..10 {
                std::thread::sleep(Duration::from_millis(300));
                if let Ok(mgr) = state_clone.lock() {
                    if mgr.active_core.is_none() {
                        return;
                    }
                }
                if let Ok(s) = TcpStream::connect("127.0.0.1:9090") {
                    stream_opt = Some(s);
                    break;
                }
            }
            if let Some(mut stream) = stream_opt {
                let _ = stream.write_all(
                    b"GET /traffic HTTP/1.1\r\nHost: 127.0.0.1:9090\r\nConnection: close\r\n\r\n",
                );
                let reader = BufReader::new(stream);
                for line in reader.lines().map_while(Result::ok) {
                    if !line.starts_with('{') {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        let up = val.get("up").and_then(|v| v.as_u64()).unwrap_or(0);
                        let down = val.get("down").and_then(|v| v.as_u64()).unwrap_or(0);
                        if let Ok(mut mgr) = state_clone.lock() {
                            if mgr.active_core.is_none() {
                                break;
                            }
                            mgr.last_traffic = (up, down);
                        }
                    }
                }
            }
        });
    }

    Ok(format!("Подключено через {}", core))
}

#[tauri::command]
pub fn disconnect_vpn(state: tauri::State<'_, SharedCore>) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = manager.child.take() {
        let _ = child.kill();
        let _ = child.wait();
        manager.push_log("[67VPN] Туннель остановлен".to_string());
    }
    if let Some(mut aux) = manager.aux_child.take() {
        let _ = aux.kill();
        let _ = aux.wait();
    }
    manager.active_core = None;
    Ok(())
}



#[tauri::command]
pub fn get_logs(state: tauri::State<'_, SharedCore>) -> Result<Vec<String>, String> {
    let manager = state.lock().map_err(|e| e.to_string())?;
    Ok(manager.logs.clone())
}

#[derive(serde::Serialize)]
pub struct TrafficStats {
    pub up: u64,
    pub down: u64,
}

#[tauri::command]
pub fn get_traffic_stats(state: tauri::State<'_, SharedCore>) -> TrafficStats {
    if let Ok(mgr) = state.lock() {
        return TrafficStats {
            up: mgr.last_traffic.0,
            down: mgr.last_traffic.1,
        };
    }
    TrafficStats { up: 0, down: 0 }
}

#[tauri::command]
pub fn clear_logs(state: tauri::State<'_, SharedCore>) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.logs.clear();
    Ok(())
}



#[tauri::command]
pub fn set_log_limit(state: tauri::State<'_, SharedCore>, limit: usize) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    let clamped = limit.clamp(100, 10000);
    manager.max_logs = clamped;
    if manager.logs.len() > clamped {
        let drain_count = manager.logs.len() - clamped;
        manager.logs.drain(0..drain_count);
    }
    Ok(())
}

#[tauri::command]
pub fn is_core_running(state: tauri::State<'_, SharedCore>) -> bool {
    if let Ok(mut mgr) = state.lock() {
        let main_ok = match mgr.child {
            Some(ref mut child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        };
        let aux_ok = match mgr.aux_child {
            Some(ref mut aux) => matches!(aux.try_wait(), Ok(None)),
            None => true,
        };
        return main_ok && aux_ok;
    }
    false
}

#[tauri::command]
pub fn set_minimize_to_tray(
    state: tauri::State<'_, SharedCore>,
    enable: bool,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.minimize_to_tray = enable;
    Ok(())
}

#[tauri::command]
pub fn set_kill_on_exit(
    state: tauri::State<'_, SharedCore>,
    enable: bool,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.kill_on_exit = enable;
    #[cfg(target_os = "windows")]
    set_job_kill_on_close(manager.job_handle, enable);
    Ok(())
}

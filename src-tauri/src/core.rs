use std::io::{BufRead, BufReader};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
fn create_kill_on_close_job() -> usize {
    #[repr(C)]
    struct BasicLimitInfo {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }
    #[repr(C)]
    struct IoCounters {
        _data: [u64; 6],
    }
    #[repr(C)]
    struct ExtendedLimitInfo {
        basic: BasicLimitInfo,
        io: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attrs: *mut std::ffi::c_void, name: *const u16) -> *mut std::ffi::c_void;
        fn SetInformationJobObject(
            job: *mut std::ffi::c_void,
            class: u32,
            info: *const std::ffi::c_void,
            len: u32,
        ) -> i32;
    }
    unsafe {
        let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
        if job.is_null() {
            return 0;
        }
        let mut info: ExtendedLimitInfo = std::mem::zeroed();
        info.basic.limit_flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        SetInformationJobObject(
            job,
            9, // JobObjectExtendedLimitInformation
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<ExtendedLimitInfo>() as u32,
        );
        job as usize
    }
}

#[cfg(target_os = "windows")]
fn assign_child_to_job(job_handle: usize, child: &Child) {
    if job_handle == 0 {
        return;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn AssignProcessToJobObject(
            job: *mut std::ffi::c_void,
            process: *mut std::ffi::c_void,
        ) -> i32;
    }
    unsafe {
        let _ = AssignProcessToJobObject(
            job_handle as *mut std::ffi::c_void,
            child.as_raw_handle() as *mut std::ffi::c_void,
        );
    }
}

pub struct CoreManager {
    pub child: Option<Child>,
    pub aux_child: Option<Child>,
    pub logs: Vec<String>,
    pub max_logs: usize,
    pub active_core: Option<String>,
    pub last_traffic: (u64, u64),
    pub minimize_to_tray: bool,
    pub job_handle: usize,
}

impl CoreManager {
    pub fn new() -> Self {
        #[cfg(target_os = "windows")]
        let job_handle = create_kill_on_close_job();
        #[cfg(not(target_os = "windows"))]
        let job_handle = 0;
        Self {
            child: None,
            aux_child: None,
            logs: Vec::new(),
            max_logs: 2000,
            active_core: None,
            last_traffic: (0, 0),
            minimize_to_tray: true,
            job_handle,
        }
    }

    pub fn push_log(&mut self, line: String) {
        self.logs.push(line);
        let limit = self.max_logs.max(100);
        if self.logs.len() > limit {
            let drain_count = self.logs.len() - limit;
            self.logs.drain(0..drain_count);
        }
    }
}

pub type SharedCore = Arc<Mutex<CoreManager>>;

fn resolve_binary_path(core_name: &str) -> Result<PathBuf, String> {
    let exe_name = if core_name == "xray" {
        "xray.exe"
    } else {
        "sing-box.exe"
    };

    // 1. Check next to the running executable (release)
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(parent) = exe_dir.parent() {
            let candidate = parent.join("binaries").join(exe_name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // 2. Check src-tauri/binaries (dev mode)
    let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(exe_name);
    if dev_candidate.exists() {
        return Ok(dev_candidate);
    }

    Err(format!("Бинарник {} не найден", exe_name))
}

#[tauri::command]
pub async fn ping_server(
    address: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let addr_str = format!("{}:{}", address, port);
        let socket_addr = addr_str
            .to_socket_addrs()
            .map_err(|e| format!("DNS error: {}", e))?
            .next()
            .ok_or_else(|| "No address resolved".to_string())?;

        let timeout = Duration::from_millis(timeout_ms.unwrap_or(2000).clamp(300, 10000));
        let start = Instant::now();
        TcpStream::connect_timeout(&socket_addr, timeout)
            .map_err(|e| format!("Timeout: {}", e))?;
        Ok(start.elapsed().as_millis() as u64)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ping_url(
    url: String,
    proxy_port: Option<u16>,
    timeout_ms: Option<u64>,
    head_only: Option<bool>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let secs = ((timeout_ms.unwrap_or(3000).clamp(500, 15000) + 999) / 1000).to_string();
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", &secs]);
        if head_only.unwrap_or(false) {
            cmd.arg("-I");
        }
        if let Some(port) = proxy_port {
            cmd.args(["-x", &format!("socks5h://127.0.0.1:{}", port)]);
        }
        cmd.arg(&url);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let start = Instant::now();
        let output = cmd.output().map_err(|e| format!("Curl error: {}", e))?;
        let elapsed = start.elapsed().as_millis() as u64;
        if !output.status.success() {
            return Err("Timeout / Connection failed".to_string());
        }
        let code = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if code == "000" || code.is_empty() {
            return Err("No response".to_string());
        }
        Ok(elapsed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ping_icmp(address: String, timeout_ms: Option<u64>) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ms_str = timeout_ms.unwrap_or(2000).clamp(300, 10000).to_string();
        let mut cmd = Command::new("ping.exe");
        cmd.args(["-n", "1", "-w", &ms_str, &address]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let start = Instant::now();
        let output = cmd.output().map_err(|e| format!("Ping error: {}", e))?;
        let elapsed = start.elapsed().as_millis() as u64;
        if !output.status.success() {
            return Err("ICMP timeout".to_string());
        }
        let out_str = String::from_utf8_lossy(&output.stdout);
        for token in out_str.split_whitespace() {
            if let Some(rest) = token.strip_prefix("time=").or_else(|| token.strip_prefix("время=")) {
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(parsed) = digits.parse::<u64>() {
                    return Ok(parsed.max(1));
                }
            }
        }
        Ok(elapsed)
    })
    .await
    .map_err(|e| e.to_string())?
}

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
    #[cfg(target_os = "windows")]
    if kill_on_exit.unwrap_or(true) {
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
        if kill_on_exit.unwrap_or(true) {
            assign_child_to_job(manager.job_handle, &a_child);
        }
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



#[derive(serde::Serialize)]
pub struct SubscriptionResponse {
    pub body: String,
    pub userinfo: Option<String>,
}

#[tauri::command]
pub async fn fetch_subscription(
    url: String,
    user_agent: Option<String>,
    send_hwid: Option<bool>,
) -> Result<SubscriptionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ua = user_agent
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "67VPN/0.7.0".to_string());
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-i", "-sL", "--max-time", "15", "-A", &ua]);
        if send_hwid.unwrap_or(false) {
            let hwid = format!(
                "67vpn-{}",
                std::env::var("COMPUTERNAME").unwrap_or_else(|_| "win".to_string())
            );
            cmd.args(["-H", &format!("x-hwid: {}", hwid)]);
        }
        cmd.arg(&url);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let output = cmd
            .output()
            .map_err(|e| format!("Ошибка загрузки подписки: {}", e))?;

        if !output.status.success() {
            return Err("Не удалось загрузить подписку".to_string());
        }

        let raw = String::from_utf8_lossy(&output.stdout).to_string();
        let (headers_part, body_part) = if let Some(idx) = raw.rfind("\r\n\r\n") {
            (&raw[..idx], raw[idx + 4..].to_string())
        } else if let Some(idx) = raw.rfind("\n\n") {
            (&raw[..idx], raw[idx + 2..].to_string())
        } else {
            ("", raw)
        };

        let mut userinfo = None;
        for line in headers_part.lines() {
            let lower = line.to_lowercase();
            if lower.starts_with("subscription-userinfo:") {
                if let Some((_, val)) = line.split_once(':') {
                    userinfo = Some(val.trim().to_string());
                }
            }
        }

        Ok(SubscriptionResponse {
            body: body_part,
            userinfo,
        })
    })
    .await
    .map_err(|e| e.to_string())?
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


#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest_version: String,
    pub url: String,
    pub changelog: String,
    pub is_prerelease: bool,
}

#[tauri::command]
pub async fn check_github_update(
    repo: String,
    current_version: String,
    include_prerelease: Option<bool>,
) -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clean_repo = repo.trim().trim_matches('/');
        if clean_repo.is_empty() || !clean_repo.contains('/') {
            return Err("Укажите репозиторий в формате owner/repo".to_string());
        }
        let use_pre = include_prerelease.unwrap_or(false);
        let api_url = if use_pre {
            format!("https://api.github.com/repos/{}/releases?per_page=1", clean_repo)
        } else {
            format!("https://api.github.com/repos/{}/releases/latest", clean_repo)
        };
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-sL", "--max-time", "10", "-A", "67VPN/0.9.0", &api_url]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("Ошибка сети: {}", e))?;
        if !output.status.success() {
            return Err("Не удалось проверить обновления".to_string());
        }
        let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| "Некорректный ответ GitHub API".to_string())?;
        let json = if use_pre {
            parsed.as_array().and_then(|a| a.first()).cloned().ok_or_else(|| "Релизы не найдены".to_string())?
        } else {
            parsed
        };
        let is_prerelease = json.get("prerelease").and_then(|v| v.as_bool()).unwrap_or(false);
        let tag = json
            .get("tag_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim_start_matches('v')
            .to_string();
        if tag.is_empty() {
            return Err("Релизы не найдены".to_string());
        }
        let html_url = json
            .get("html_url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let arch_tag = match std::env::consts::ARCH {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            "x86" => "x86",
            other => other,
        };
        let exe_url = json
            .get("assets")
            .and_then(|a| a.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find_map(|item| {
                        let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
                        if name.ends_with(".exe") && name.contains(arch_tag) {
                            item.get("browser_download_url").and_then(|u| u.as_str()).map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                    .or_else(|| {
                        arr.iter().find_map(|item| {
                            let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
                            if name.ends_with(".exe") {
                                item.get("browser_download_url").and_then(|u| u.as_str()).map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                    })
            })
            .unwrap_or_default();
        let changelog = json
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("Описание изменений отсутствует.")
            .to_string();

        let cur = current_version.trim_start_matches('v');
        let has_update = tag != cur;
        Ok(UpdateInfo {
            has_update,
            latest_version: tag,
            url: exe_url,
            changelog,
            is_prerelease,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn download_and_run_update(
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    if !url.ends_with(".exe") {
        return Err("NOT_EXE".to_string());
    }
    let tmp_exe = std::env::temp_dir().join("67VPN_Setup.exe");
    let tmp_str = tmp_exe.to_string_lossy().to_string();
    let url_clone = url.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-sL", "--max-time", "120", "-o", &tmp_str, &url_clone]);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        let output = cmd.output().map_err(|e| format!("Ошибка загрузки: {}", e))?;
        if !output.status.success() {
            return Err("Не удалось скачать обновление".to_string());
        }
        Command::new(&tmp_str)
            .spawn()
            .map_err(|e| format!("Не удалось запустить установщик: {}", e))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    app.exit(0);
    Ok(())
}

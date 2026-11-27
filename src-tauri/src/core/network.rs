use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::{Duration, Instant};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

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

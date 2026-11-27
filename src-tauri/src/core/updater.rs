use super::{set_kill_switch, set_system_proxy, SharedCore};
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn parse_semver(v: &str) -> (u32, u32, u32) {
    let clean = v.trim().trim_start_matches('v');
    let mut parts = clean.split('.');
    let parse_num = |s: Option<&str>| -> u32 {
        s.unwrap_or("0")
            .split('-')
            .next()
            .unwrap_or("0")
            .parse::<u32>()
            .unwrap_or(0)
    };
    (
        parse_num(parts.next()),
        parse_num(parts.next()),
        parse_num(parts.next()),
    )
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
        cmd.args(["-sL", "--max-time", "10", "-A", "67VPN/0.9.2", &api_url]);
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
        let _html_url = json
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
        let has_update = parse_semver(&tag) > parse_semver(cur);
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
    state: tauri::State<'_, SharedCore>,
    url: String,
) -> Result<(), String> {
    use tauri::Emitter;

    if !url.ends_with(".exe") {
        return Err("NOT_EXE".to_string());
    }
    let tmp_exe = std::env::temp_dir().join("67VPN_Setup.exe");
    let tmp_str = tmp_exe.to_string_lossy().to_string();
    let url_clone = url.clone();
    let app_clone = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-L", "--max-time", "180", "--progress-bar", "-o", &tmp_str, &url_clone])
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        let mut child = cmd.spawn().map_err(|e| format!("Ошибка загрузки: {}", e))?;
        if let Some(mut stderr) = child.stderr.take() {
            let mut buf = [0u8; 512];
            let mut last_percent: u8 = 0;
            let mut acc = String::new();
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                acc.push_str(&String::from_utf8_lossy(&buf[..n]));
                if let Some(pos) = acc.rfind('%') {
                    let prefix = &acc[..pos];
                    let num_str: String = prefix
                        .chars()
                        .rev()
                        .take_while(|c| c.is_ascii_digit() || *c == '.')
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect();
                    if let Ok(val) = num_str.parse::<f32>() {
                        let pct = val.clamp(0.0, 100.0) as u8;
                        if pct != last_percent {
                            last_percent = pct;
                            let _ = app_clone.emit("update-download-progress", serde_json::json!({ "percent": pct }));
                        }
                    }
                    acc.clear();
                }
            }
        }

        let status = child.wait().map_err(|e| format!("Ошибка загрузки: {}", e))?;
        if !status.success() {
            return Err("Не удалось скачать обновление".to_string());
        }
        let _ = app_clone.emit("update-download-progress", serde_json::json!({ "percent": 100 }));
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    // Gracefully stop running VPN cores, proxy, and kill switch before updating
    let _ = set_system_proxy(false, 10808);
    let _ = set_kill_switch(false);
    if let Ok(mut mgr) = state.lock() {
        if let Some(mut child) = mgr.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(mut aux) = mgr.aux_child.take() {
            let _ = aux.kill();
            let _ = aux.wait();
        }
        mgr.active_core = None;
    }

    #[cfg(target_os = "windows")]
    {
        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let script = format!(
            "\"{}\" /S && start \"\" \"{}\"",
            tmp_exe.display(),
            current_exe.display()
        );
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/C", &script]).creation_flags(0x08000000);
        cmd.spawn()
            .map_err(|e| format!("Не удалось запустить установщик: {}", e))?;
    }

    app.exit(0);
    Ok(())
}

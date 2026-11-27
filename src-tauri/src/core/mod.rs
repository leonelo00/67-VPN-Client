pub mod network;
pub mod runner;
pub mod system;
pub mod updater;

pub use network::*;
pub use runner::*;
pub use system::*;
pub use updater::*;

use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;

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

#[cfg(target_os = "windows")]
fn set_job_kill_on_close(job_handle: usize, enable: bool) {
    if job_handle == 0 {
        return;
    }
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
        fn SetInformationJobObject(
            job: *mut std::ffi::c_void,
            class: u32,
            info: *const std::ffi::c_void,
            len: u32,
        ) -> i32;
    }
    unsafe {
        let mut info: ExtendedLimitInfo = std::mem::zeroed();
        info.basic.limit_flags = if enable { 0x2000 } else { 0 };
        let _ = SetInformationJobObject(
            job_handle as *mut std::ffi::c_void,
            9, // JobObjectExtendedLimitInformation
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<ExtendedLimitInfo>() as u32,
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
    pub kill_on_exit: bool,
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
            kill_on_exit: true,
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

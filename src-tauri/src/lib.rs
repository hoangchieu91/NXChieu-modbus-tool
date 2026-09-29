mod modbus;
mod models;

use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use crate::modbus::client::ModbusManager;
use crate::modbus::serial;
use crate::models::{
    ConnectionConfig, PollDefinition, PollResult, SerialPortDetail, WriteCoilParam,
    WriteRegisterParam,
};

pub struct AppState {
    pub manager: Arc<Mutex<ModbusManager>>,
}

#[tauri::command]
fn list_serial_ports() -> Vec<SerialPortDetail> {
    serial::list_ports()
}

#[tauri::command]
async fn connect(state: State<'_, AppState>, config: ConnectionConfig) -> Result<String, String> {
    let mut mgr = state.manager.lock().await;
    mgr.connect(config).await
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut mgr = state.manager.lock().await;
    mgr.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn get_connection_status(state: State<'_, AppState>) -> Result<bool, String> {
    let mgr = state.manager.lock().await;
    Ok(mgr.is_connected())
}

#[tauri::command]
async fn start_polling(
    app: AppHandle,
    state: State<'_, AppState>,
    definition: PollDefinition,
) -> Result<(), String> {
    {
        let mgr = state.manager.lock().await;
        if !mgr.is_connected() {
            return Err("Cannot start polling: not connected to device".to_string());
        }
        mgr.is_polling.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let (is_polling_flag, manager_arc) = {
        let mgr = state.manager.lock().await;
        if !mgr.is_connected() {
            return Err("Cannot start polling: not connected to device".to_string());
        }
        mgr.is_polling.store(true, std::sync::atomic::Ordering::Relaxed);
        (mgr.is_polling.clone(), state.manager.clone())
    };

    let scan_rate = definition.scan_rate_ms.max(50);

    tokio::spawn(async move {
        while is_polling_flag.load(std::sync::atomic::Ordering::Relaxed) {
            let res = {
                let mut guard = manager_arc.lock().await;
                if !guard.is_connected() {
                    break;
                }
                guard.execute_read(&definition).await
            };

            if let Err(e) = app.emit("poll-data", &res) {
                eprintln!("[start_polling] Failed to emit poll-data: {:?}", e);
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(scan_rate)).await;
        }
    });

    Ok(())
}

#[tauri::command]
async fn stop_polling(state: State<'_, AppState>) -> Result<(), String> {
    let mgr = state.manager.lock().await;
    mgr.is_polling.store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn read_once(
    state: State<'_, AppState>,
    definition: PollDefinition,
) -> Result<PollResult, String> {
    let mut mgr = state.manager.lock().await;
    if !mgr.is_connected() {
        return Err("Not connected to device".to_string());
    }
    Ok(mgr.execute_read(&definition).await)
}

#[tauri::command]
async fn write_single_register(
    state: State<'_, AppState>,
    param: WriteRegisterParam,
) -> Result<(), String> {
    let mut mgr = state.manager.lock().await;
    mgr.write_register(param).await
}

#[tauri::command]
async fn write_single_coil(
    state: State<'_, AppState>,
    param: WriteCoilParam,
) -> Result<(), String> {
    let mut mgr = state.manager.lock().await;
    mgr.write_coil(param).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        manager: Arc::new(Mutex::new(ModbusManager::new())),
    };

    tauri::Builder::default()
        .manage(state)
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect,
            disconnect,
            get_connection_status,
            start_polling,
            stop_polling,
            read_once,
            write_single_register,
            write_single_coil
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

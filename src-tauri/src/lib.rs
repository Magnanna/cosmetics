mod printer;

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Where the chosen receipt printer name is remembered between launches.
fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("printer.txt"))
}

fn saved_printer(app: &tauri::AppHandle) -> Option<String> {
    let path = config_path(app).ok()?;
    let name = fs::read_to_string(path).ok()?.trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

#[tauri::command]
fn list_printers() -> Result<Vec<String>, String> {
    printer::list()
}

#[tauri::command]
fn get_printer(app: tauri::AppHandle) -> Option<String> {
    saved_printer(&app)
}

#[tauri::command]
fn set_printer(app: tauri::AppHandle, name: String) -> Result<(), String> {
    fs::write(config_path(&app)?, name.trim()).map_err(|e| e.to_string())
}

/// Sends raw ESC/POS bytes (built by the web app) straight to the receipt printer.
#[tauri::command]
fn print_raw(app: tauri::AppHandle, data: Vec<u8>) -> Result<(), String> {
    let name = saved_printer(&app).ok_or("No receipt printer chosen yet. Pick one in Till settings.")?;
    printer::send_raw(&name, &data)
}

/// Pulses the cash drawer connected to the printer's RJ11 port.
#[tauri::command]
fn open_drawer(app: tauri::AppHandle) -> Result<(), String> {
    let name = saved_printer(&app).ok_or("No receipt printer chosen yet. Pick one in Till settings.")?;
    printer::send_raw(&name, &[0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_printers, get_printer, set_printer, print_raw, open_drawer])
        .run(tauri::generate_context!())
        .expect("error while running Kenfri Till");
}

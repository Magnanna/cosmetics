//! Raw printing to an ESC/POS receipt printer by its OS printer name.
//! Windows: the print spooler with the RAW datatype (the XP-Q80's normal setup).
//! macOS/Linux: CUPS `lp -o raw`.

#[cfg(not(windows))]
pub fn list() -> Result<Vec<String>, String> {
    let out = std::process::Command::new("lpstat").arg("-a").output().map_err(|e| format!("Couldn't list printers: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.split_whitespace().next().map(str::to_string))
        .collect())
}

#[cfg(not(windows))]
pub fn send_raw(name: &str, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new("lp")
        .args(["-d", name, "-o", "raw"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start lp: {e}"))?;
    child.stdin.take().ok_or("lp has no input")?.write_all(data).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("Printer said: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

#[cfg(windows)]
pub fn list() -> Result<Vec<String>, String> {
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"])
        .output()
        .map_err(|e| format!("Couldn't list printers: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect())
}

#[cfg(windows)]
pub fn send_raw(name: &str, data: &[u8]) -> Result<(), String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let mut printer_name = wide(name);
    let mut doc_name = wide("Kenfri receipt");
    let mut datatype = wide("RAW");

    unsafe {
        let mut handle = HANDLE::default();
        OpenPrinterW(PCWSTR(printer_name.as_mut_ptr()), &mut handle, None).map_err(|e| format!("Couldn't open printer \"{name}\": {e}"))?;
        let doc = DOC_INFO_1W { pDocName: PWSTR(doc_name.as_mut_ptr()), pOutputFile: PWSTR::null(), pDatatype: PWSTR(datatype.as_mut_ptr()) };
        let result = (|| {
            if StartDocPrinterW(handle, 1, &doc) == 0 {
                return Err("The printer refused the job.".to_string());
            }
            let _ = StartPagePrinter(handle);
            let mut written: u32 = 0;
            let ok = WritePrinter(handle, data.as_ptr() as *const _, data.len() as u32, &mut written).as_bool();
            let _ = EndPagePrinter(handle);
            let _ = EndDocPrinter(handle);
            if !ok || written as usize != data.len() {
                return Err("The printer didn't take the whole receipt.".to_string());
            }
            Ok(())
        })();
        let _ = ClosePrinter(handle);
        result
    }
}

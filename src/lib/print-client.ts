"use client";

import { receiptBytes } from "./escpos";
import type { ReceiptData } from "./receipt";

interface TauriBridge {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
}

function tauri(): TauriBridge | null {
  return (globalThis as unknown as { __TAURI__?: TauriBridge }).__TAURI__ ?? null;
}

export function inDesktopApp(): boolean {
  return tauri() !== null;
}

/**
 * Prints a receipt. In the desktop app: raw ESC/POS to the chosen printer
 * (and opens the drawer for cash). In a normal browser: the 80mm web receipt
 * in a hidden frame, via the print dialog.
 */
export async function printReceipt(token: string, openDrawer: boolean, reprint = false): Promise<void> {
  const t = tauri();
  if (t) {
    const res = await fetch(`/api/receipts/${token}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Couldn't load the receipt.");
    const data = (await res.json()) as ReceiptData;
    const bytes = receiptBytes(data, { openDrawer, reprint, receiptUrl: `${location.origin}/r/${token}` });
    await t.core.invoke("print_raw", { data: Array.from(bytes) });
    return;
  }
  await new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    frame.src = `/r/${token}?print=1`;
    frame.onload = () => {
      setTimeout(() => {
        frame.remove();
        resolve();
      }, 60_000);
      resolve();
    };
    document.body.appendChild(frame);
  });
}

export async function openDrawer(): Promise<void> {
  const t = tauri();
  if (!t) throw new Error("The cash drawer only opens from the desktop app.");
  await t.core.invoke("open_drawer");
}

export async function listPrinters(): Promise<{ printers: string[]; current: string | null }> {
  const t = tauri();
  if (!t) return { printers: [], current: null };
  const [printers, current] = await Promise.all([t.core.invoke<string[]>("list_printers"), t.core.invoke<string | null>("get_printer")]);
  return { printers, current };
}

export async function choosePrinter(name: string): Promise<void> {
  const t = tauri();
  if (!t) throw new Error("Printer setup only works in the desktop app.");
  await t.core.invoke("set_printer", { name });
}

/** A short test slip so the owner can confirm the printer and 80mm width. */
export async function printTestPage(shopName: string): Promise<void> {
  const t = tauri();
  if (!t) throw new Error("Printer setup only works in the desktop app.");
  const text = `${shopName}\nPrinter test\n${"-".repeat(48)}\n${"123456789-".repeat(4)}12345678\nIf this line fits on one row, width is right.\n\n\n\n`;
  const bytes = [0x1b, 0x40, ...Array.from(new TextEncoder().encode(text)), 0x1d, 0x56, 0x01];
  await t.core.invoke("print_raw", { data: bytes });
}

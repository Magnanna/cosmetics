import type { ReceiptData } from "./receipt";

/**
 * ESC/POS receipt for 80mm printers (Xprinter XP-Q80): 48 characters per line
 * in Font A. Pure — returns bytes the desktop shell sends to the printer raw.
 */
const ESC = 0x1b;
const GS = 0x1d;
const WIDTH = 48;

class Builder {
  private bytes: number[] = [ESC, 0x40]; // initialise
  raw(...b: number[]) { this.bytes.push(...b); return this; }
  text(s: string) {
    // Printers default to CP437; keep to ASCII so nothing prints as garbage.
    const ascii = s.normalize("NFKD").replace(/[·•]/g, "-").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\n]/g, "");
    for (const ch of ascii) this.bytes.push(ch.charCodeAt(0));
    return this;
  }
  line(s = "") { return this.text(s + "\n"); }
  align(a: "left" | "center" | "right") { return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(double: boolean) { return this.raw(GS, 0x21, double ? 0x11 : 0x00); }
  rule() { return this.line("-".repeat(WIDTH)); }
  cols(left: string, right: string) {
    const space = Math.max(1, WIDTH - left.length - right.length);
    if (left.length + right.length + 1 > WIDTH) return this.line(left).line(" ".repeat(WIDTH - right.length) + right);
    return this.line(left + " ".repeat(space) + right);
  }
  wrap(s: string, width = WIDTH) {
    const words = s.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > width) { this.line(cur); cur = w; }
      else cur = (cur + " " + w).trim();
    }
    if (cur) this.line(cur);
    return this;
  }
  qr(data: string) {
    const d = Array.from(new TextEncoder().encode(data));
    const len = d.length + 3;
    return this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00) // model 2
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 0x05) // module size
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31) // error correction M
      .raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...d)
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
  }
  cut() { return this.raw(ESC, 0x64, 4, GS, 0x56, 0x01); } // feed 4, partial cut
  drawer() { return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa); } // pulse pin 2
  build() { return new Uint8Array(this.bytes); }
}

const money = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100).toLocaleString("en-KE")}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

export function receiptBytes(r: ReceiptData, opts: { openDrawer: boolean; reprint: boolean; receiptUrl?: string }): Uint8Array {
  const b = new Builder();
  if (opts.openDrawer) b.drawer();
  b.align("center").bold(true).size(true).line(r.shop.name).size(false).bold(false);
  if (r.shop.address) b.line(r.shop.address);
  if (r.shop.phone) b.line(`Tel ${r.shop.phone}`);
  if (r.shop.kraPin) b.line(`PIN ${r.shop.kraPin}`);
  if (opts.reprint) b.bold(true).line("*** REPRINT ***").bold(false);
  b.line().align("left");
  const when = new Date(r.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });
  b.cols(`Receipt ${r.receiptNo}`, when);
  b.cols(`Served by ${r.cashier}`, r.customer.phoneMasked);
  b.rule();
  for (const l of r.lines) {
    b.wrap(l.description);
    b.cols(`  ${l.qty} x ${money(l.unitCents)}`, money(l.qty * l.unitCents));
    if (l.discountCents > 0) b.cols("  Discount", `-${money(l.discountCents)}`);
  }
  b.rule();
  if (r.discountCents > 0) {
    b.cols("Subtotal", money(r.grossCents));
    b.cols("Discount", `-${money(r.discountCents)}`);
  }
  b.bold(true).size(true).cols("TOTAL", money(r.totalCents)).size(false).bold(false);
  b.line();
  for (const p of r.payments) {
    if (p.method === "cash") {
      b.cols("Cash", money(p.tenderedCents ?? p.amountCents));
      if ((p.changeCents ?? 0) > 0) b.cols("Change", money(p.changeCents!));
    } else if (p.method === "mpesa") b.cols(`M-Pesa ${p.mpesaCode}`, money(p.amountCents));
    else if (p.method === "credit") b.cols("On account", money(p.amountCents));
    else b.cols(p.method, money(p.amountCents));
  }
  if (r.customer.pointsBalance !== null) {
    b.line();
    if (r.pointsEarned > 0) b.cols("Points earned", (r.pointsEarned / 100).toFixed(2));
    b.cols("Points balance", (r.customer.pointsBalance / 100).toFixed(2));
  }
  b.line().align("center");
  if (r.shop.footer) b.wrap(r.shop.footer);
  if (opts.receiptUrl) b.line().qr(opts.receiptUrl).line("Scan for your digital receipt");
  b.line().cut();
  return b.build();
}

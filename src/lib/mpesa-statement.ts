/**
 * Parses an M-Pesa till/org statement exported as CSV from the M-Pesa portal.
 * Portal exports start with a few title lines; we find the header row by its
 * "Receipt No" and "Paid In" columns. Pure — no database.
 */

export interface StatementLine {
  code: string;
  completedAt: string; // YYYY-MM-DD HH:MM:SS
  details: string;
  paidInCents: number;
  withdrawnCents: number;
}

/** Minimal RFC-4180 CSV splitter (quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function cents(v: string | undefined): number {
  const cleaned = (v ?? "").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return 0;
  const n = Math.round(Math.abs(Number(cleaned)) * 100);
  return Number.isFinite(n) ? n : 0;
}

/** Accepts 2026-09-30 14:22:10, 30-09-2026 14:22:10, 30/09/2026 14:22 … → YYYY-MM-DD HH:MM:SS */
export function normalizeDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4].padStart(2, "0")}:${m[5]}:${m[6] ?? "00"}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${m[4].padStart(2, "0")}:${m[5]}:${m[6] ?? "00"}`;
  return null;
}

export class StatementError extends Error {}

export function parseMpesaStatement(text: string): StatementLine[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const headerIdx = rows.findIndex((r) => r.some((c) => /receipt\s*no/i.test(c)) && r.some((c) => /paid\s*in/i.test(c)));
  if (headerIdx < 0) throw new StatementError("This doesn't look like an M-Pesa statement. Export it as CSV from the M-Pesa portal (it needs “Receipt No.” and “Paid In” columns).");
  const h = rows[headerIdx].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const iCode = col(/receipt\s*no/);
  const iTime = col(/completion\s*time/) >= 0 ? col(/completion\s*time/) : col(/time|date/);
  const iDetails = col(/details|description/);
  const iStatus = col(/status/);
  const iIn = col(/paid\s*in/);
  const iOut = col(/withdrawn|paid\s*out/);
  const out: StatementLine[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const code = (r[iCode] ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(code)) continue;
    if (iStatus >= 0 && r[iStatus] && !/completed/i.test(r[iStatus])) continue;
    const completedAt = normalizeDate(r[iTime] ?? "");
    if (!completedAt) continue;
    out.push({ code, completedAt, details: (r[iDetails] ?? "").trim(), paidInCents: cents(r[iIn]), withdrawnCents: iOut >= 0 ? cents(r[iOut]) : 0 });
  }
  if (out.length === 0) throw new StatementError("No completed transactions found in that file.");
  return out;
}

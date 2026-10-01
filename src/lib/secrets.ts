import crypto from "node:crypto";

/**
 * Encrypts per-shop provider credentials at rest (AES-256-GCM), as Zeno does.
 * Key: SETTINGS_ENC_KEY — 32 bytes, base64. Format: iv:authTag:data (hex).
 */
function key(): Buffer {
  const k = process.env.SETTINGS_ENC_KEY;
  if (!k) throw new Error("SETTINGS_ENC_KEY is missing from the environment.");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) throw new Error("SETTINGS_ENC_KEY must be 32 bytes, base64-encoded.");
  return buf;
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${data.toString("hex")}`;
}

export function decryptJson<T>(stored: string | null): T | null {
  if (!stored) return null;
  const [iv, tag, data] = stored.split(":");
  if (!iv || !tag || !data) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
    d.setAuthTag(Buffer.from(tag, "hex"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "hex")), d.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

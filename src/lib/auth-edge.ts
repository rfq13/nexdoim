/**
 * Edge-compatible session token verification.
 * Uses only Web Crypto API (crypto.subtle) — works in Edge Runtime and Node.js.
 *
 * Token format: `session:{timestamp}.{hex_hmac}`
 */

// Must match the same fallback chain as auth.ts (Node.js version)
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.ADMIN_PASSWORD ||
  "meridian-default-session-key";

const encoder = new TextEncoder();

let _cryptoKey: CryptoKey | null = null;

async function getCryptoKey(): Promise<CryptoKey> {
  if (_cryptoKey) return _cryptoKey;
  _cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return _cryptoKey;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Verify a session token signed with HMAC-SHA256.
 * Async because Web Crypto API is promise-based.
 */
export async function verifySessionToken(token: string): Promise<boolean> {
  if (!SESSION_SECRET || !token || !token.includes(".")) return false;
  const lastDot = token.lastIndexOf(".");
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if (sig.length !== 64) return false; // SHA-256 hex = 64 chars
  try {
    const key = await getCryptoKey();
    const sigBytes = hexToBytes(sig);
    return await crypto.subtle.verify("HMAC", key, sigBytes as ArrayBufferView<ArrayBuffer>, encoder.encode(payload));
  } catch {
    return false;
  }
}

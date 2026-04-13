import { createHmac } from "crypto";

// Session secret must be consistent between auth.ts (Node.js) and auth-edge.ts (Edge Runtime).
// Both files resolve the same env vars in the same order.
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.ADMIN_PASSWORD ||
  "meridian-default-session-key";

/**
 * Create a signed session token. The token is an HMAC signature of the
 * payload, making it unforgeable without the secret.
 */
export function createSessionToken(): string {
  const payload = `session:${Date.now()}`;
  const sig = createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

/**
 * Verify that a session token was signed with the current secret.
 */
export function verifySessionToken(token: string): boolean {
  if (!token || !token.includes(".")) return false;
  const lastDot = token.lastIndexOf(".");
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  // Constant-time comparison
  if (sig.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Rate Limiter ─────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

/**
 * Check if an IP is rate-limited for login attempts.
 * Returns { allowed: true } or { allowed: false, retryAfterSeconds }.
 */
export function checkLoginRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
} {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count++;
  return { allowed: true };
}

/**
 * Reset rate limit for an IP after successful login.
 */
export function resetLoginRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

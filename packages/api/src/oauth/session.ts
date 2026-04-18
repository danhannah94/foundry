/**
 * Signed-cookie helpers using HMAC-SHA256.
 * Fail loud at call time if FOUNDRY_OAUTH_SESSION_SECRET is unset.
 *
 * Cookie format: base64url(JSON(payload)) + '.' + base64url(HMAC)
 */

import crypto from 'crypto';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getSecret(): Buffer {
  const secret = process.env.FOUNDRY_OAUTH_SESSION_SECRET;
  if (!secret) {
    throw new Error('FOUNDRY_OAUTH_SESSION_SECRET is required but not set');
  }
  return Buffer.from(secret, 'utf8');
}

function toBase64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromBase64url(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

function computeHmac(payloadB64: string, secret: Buffer): Buffer {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest();
}

// ─── signCookie ───────────────────────────────────────────────────────────────

/**
 * Serialize an object into a signed cookie string.
 * The object should include an `exp` field (Unix timestamp in seconds) for TTL.
 */
export function signCookie(value: object): string {
  const secret = getSecret();
  const payloadB64 = toBase64url(Buffer.from(JSON.stringify(value), 'utf8'));
  const hmac = computeHmac(payloadB64, secret);
  const hmacB64 = toBase64url(hmac);
  return `${payloadB64}.${hmacB64}`;
}

// ─── verifyCookie ─────────────────────────────────────────────────────────────

/**
 * Verify a signed cookie string. Returns the payload object or null if:
 * - HMAC is invalid (timing-safe comparison)
 * - Cookie is expired (payload.exp < now)
 * - Cookie is malformed
 */
export function verifyCookie(raw: string): Record<string, unknown> | null {
  const secret = getSecret();

  const dotIndex = raw.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const payloadB64 = raw.slice(0, dotIndex);
  const hmacB64 = raw.slice(dotIndex + 1);

  let expectedHmac: Buffer;
  let actualHmac: Buffer;
  try {
    expectedHmac = computeHmac(payloadB64, secret);
    actualHmac = fromBase64url(hmacB64);
  } catch {
    return null;
  }

  // Constant-time comparison — ensure buffers are same length before comparing
  if (expectedHmac.length !== actualHmac.length) return null;
  if (!crypto.timingSafeEqual(expectedHmac, actualHmac)) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Check expiry
  const exp = payload.exp;
  if (typeof exp !== 'number' || Date.now() / 1000 > exp) return null;

  return payload;
}

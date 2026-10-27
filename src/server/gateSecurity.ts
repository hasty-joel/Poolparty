import crypto from 'node:crypto';
import type express from 'express';

export type StaffRole = 'gate_staff' | 'admin';

export interface GateSessionPayload {
  v: 1;
  sid: string;
  role: StaffRole;
  iat: number;
  exp: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const SESSION_TOKEN_PREFIX = 'ppgs1';
const GATE_COOKIE_NAME = 'pp_gate_session';
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const MIN_SESSION_TTL_SECONDS = 5;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// Per-process ephemeral fallback salt when GATE_SESSION_SECRET is not explicitly set
const _ephemeralBootSalt = crypto.randomBytes(32).toString('hex');
const _revokedSessionIds = new Map<string, number>(); // sid -> expMs
const _rateLimitBuckets = new Map<string, RateLimitBucket>();

function sanitizeSecret(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^["']|["']$/g, '').trim();
}

function sha256Buffer(input: string): Buffer {
  return crypto.createHash('sha256').update(input, 'utf8').digest();
}

/**
 * Constant-time string comparison using SHA-256 digests so secret length is never leaked.
 */
export function safeCompareSecret(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const a = sha256Buffer(candidate);
  const b = sha256Buffer(expected);
  return crypto.timingSafeEqual(a, b);
}

const MIN_ADMIN_PASSCODE_LENGTH = 12;
const MIN_GATE_PASSCODE_LENGTH = 8;

const WEAK_PLACEHOLDER_PASSCODES = new Set([
  'your_secure_passcode',
  'your_admin_passcode',
  'your_gate_passcode',
  'admin_passcode',
  'gate_passcode',
  'changeme1234',
  'changeme12345',
  'password1234',
  'password12345',
  'admin1234567',
  '123456789012',
]);

function isStrongConfiguredSecret(raw: string, minLength: number): boolean {
  if (!raw || raw.length < minLength) return false;
  const lower = raw.toLowerCase();
  if (WEAK_PLACEHOLDER_PASSCODES.has(lower)) return false;
  // Reject trivial single-character repetitions (e.g. "aaaaaaaaaaaa")
  if (/^(.)\1+$/.test(raw)) return false;
  return true;
}

function getSigningSecret(): Buffer {
  const explicitSecret = sanitizeSecret(process.env.GATE_SESSION_SECRET);
  if (explicitSecret.length >= 16) {
    return sha256Buffer(`poolparty-gate-session-v1|${explicitSecret}`);
  }

  const gatePass = sanitizeSecret(process.env.GATE_PASSCODE);
  const adminPass = sanitizeSecret(process.env.ADMIN_PASSCODE);
  const supaKey = sanitizeSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (
    isStrongConfiguredSecret(gatePass, MIN_GATE_PASSCODE_LENGTH) ||
    isStrongConfiguredSecret(adminPass, MIN_ADMIN_PASSCODE_LENGTH) ||
    supaKey.length >= 20
  ) {
    return sha256Buffer(`poolparty-gate-session-derived-v1|${gatePass}|${adminPass}|${supaKey}`);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('GATE_SESSION_SECRET or ADMIN_PASSCODE must be configured in production.');
  }

  return sha256Buffer(`poolparty-gate-session-ephemeral-v1|${_ephemeralBootSalt}`);
}

function pruneExpiredState(now = Date.now()): void {
  for (const [sid, exp] of _revokedSessionIds.entries()) {
    if (exp <= now) {
      _revokedSessionIds.delete(sid);
    }
  }
  for (const [key, bucket] of _rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      _rateLimitBuckets.delete(key);
    }
  }
}

export function extractClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).trim().slice(0, 64);
  }
  return (req.socket?.remoteAddress || req.ip || 'unknown').slice(0, 64);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isSecureRequest(req: express.Request): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  return false;
}

export const GateSecurity = {
  COOKIE_NAME: GATE_COOKIE_NAME,
  TOKEN_PREFIX: SESSION_TOKEN_PREFIX,

  getConfiguredGatePasscode(): string {
    const cleaned = sanitizeSecret(process.env.GATE_PASSCODE);
    return isStrongConfiguredSecret(cleaned, MIN_GATE_PASSCODE_LENGTH) ? cleaned : '';
  },

  getConfiguredAdminPasscode(): string {
    const cleaned = sanitizeSecret(process.env.ADMIN_PASSCODE);
    return isStrongConfiguredSecret(cleaned, MIN_ADMIN_PASSCODE_LENGTH) ? cleaned : '';
  },

  isAdminPasscodeConfigured(): boolean {
    return this.getConfiguredAdminPasscode().length >= MIN_ADMIN_PASSCODE_LENGTH;
  },

  isGatePasscodeConfigured(): boolean {
    return this.getConfiguredGatePasscode().length >= MIN_GATE_PASSCODE_LENGTH;
  },

  isGatePasscodeDistinctFromAdmin(): boolean {
    const gate = this.getConfiguredGatePasscode();
    const admin = this.getConfiguredAdminPasscode();
    if (!gate || !admin) return false;
    return !safeCompareSecret(gate, admin);
  },

  getSessionTtlSeconds(overrideSeconds?: number): number {
    if (typeof overrideSeconds === 'number' && Number.isFinite(overrideSeconds)) {
      return Math.max(1, Math.min(MAX_SESSION_TTL_SECONDS, Math.floor(overrideSeconds)));
    }
    const envVal = Number(process.env.GATE_SESSION_TTL_SECONDS);
    if (Number.isFinite(envVal) && envVal >= MIN_SESSION_TTL_SECONDS) {
      return Math.min(MAX_SESSION_TTL_SECONDS, Math.floor(envVal));
    }
    return DEFAULT_SESSION_TTL_SECONDS;
  },

  /**
   * Authenticates a submitted passcode against GATE_PASSCODE or ADMIN_PASSCODE in constant time.
   * Fails closed if neither secret is strongly configured. Never logs or echoes submitted passcodes.
   */
  verifyPasscodeRole(submittedPasscode: string): {
    matched: boolean;
    role?: StaffRole;
    reason?: 'GATE_AUTH_NOT_CONFIGURED' | 'INVALID_PASSCODE';
  } {
    const candidate = sanitizeSecret(submittedPasscode);
    const gatePasscode = this.getConfiguredGatePasscode();
    const adminPasscode = this.getConfiguredAdminPasscode();

    if (!gatePasscode && !adminPasscode) {
      return { matched: false, reason: 'GATE_AUTH_NOT_CONFIGURED' };
    }

    if (!candidate) {
      return { matched: false, reason: 'INVALID_PASSCODE' };
    }

    // Check dedicated GATE_PASSCODE first (strictly gate_staff scope unless identical to admin)
    if (gatePasscode && safeCompareSecret(candidate, gatePasscode)) {
      const alsoMatchesAdmin = Boolean(adminPasscode && safeCompareSecret(candidate, adminPasscode));
      return { matched: true, role: alsoMatchesAdmin ? 'admin' : 'gate_staff' };
    }

    // Allow authorized organizer admin passcode to open an admin-scoped gate session
    if (adminPasscode && safeCompareSecret(candidate, adminPasscode)) {
      return { matched: true, role: 'admin' };
    }

    return { matched: false, reason: 'INVALID_PASSCODE' };
  },

  /**
   * Issues an HMAC-SHA256 signed session token with explicit expiration timestamp.
   */
  issueSession(role: StaffRole, ttlSecondsOverride?: number): {
    sessionToken: string;
    payload: GateSessionPayload;
    expiresAt: string;
    expiresInSeconds: number;
  } {
    pruneExpiredState();
    const ttlSeconds = this.getSessionTtlSeconds(ttlSecondsOverride);
    const now = Date.now();
    const payload: GateSessionPayload = {
      v: 1,
      sid: crypto.randomUUID(),
      role,
      iat: now,
      exp: now + ttlSeconds * 1000,
    };

    const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signatureSegment = crypto
      .createHmac('sha256', getSigningSecret())
      .update(`${SESSION_TOKEN_PREFIX}.${payloadSegment}`, 'utf8')
      .digest('base64url');

    const sessionToken = `${SESSION_TOKEN_PREFIX}.${payloadSegment}.${signatureSegment}`;

    return {
      sessionToken,
      payload,
      expiresAt: new Date(payload.exp).toISOString(),
      expiresInSeconds: ttlSeconds,
    };
  },

  /**
   * Verifies signature, structure, revocation, and expiration of a session token.
   */
  verifySessionToken(rawToken: string | undefined | null): {
    valid: boolean;
    payload?: GateSessionPayload;
    reason?: 'MISSING' | 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'REVOKED';
  } {
    if (!rawToken || typeof rawToken !== 'string') {
      return { valid: false, reason: 'MISSING' };
    }

    const trimmed = rawToken.trim();
    const parts = trimmed.split('.');
    if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_PREFIX) {
      return { valid: false, reason: 'MALFORMED' };
    }

    const [, payloadSegment, signatureSegment] = parts;
    if (!payloadSegment || !signatureSegment) {
      return { valid: false, reason: 'MALFORMED' };
    }

    const expectedSig = crypto
      .createHmac('sha256', getSigningSecret())
      .update(`${SESSION_TOKEN_PREFIX}.${payloadSegment}`, 'utf8')
      .digest('base64url');

    if (!safeCompareSecret(signatureSegment, expectedSig)) {
      return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    let parsed: GateSessionPayload;
    try {
      parsed = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, reason: 'MALFORMED' };
    }

    if (
      !parsed ||
      parsed.v !== 1 ||
      typeof parsed.sid !== 'string' ||
      (parsed.role !== 'gate_staff' && parsed.role !== 'admin') ||
      typeof parsed.exp !== 'number'
    ) {
      return { valid: false, reason: 'MALFORMED' };
    }

    const now = Date.now();
    if (now >= parsed.exp) {
      return { valid: false, reason: 'EXPIRED' };
    }

    if (_revokedSessionIds.has(parsed.sid)) {
      return { valid: false, reason: 'REVOKED' };
    }

    return { valid: true, payload: parsed };
  },

  revokeSessionToken(rawToken: string | undefined | null): boolean {
    const verified = this.verifySessionToken(rawToken);
    if (!verified.valid || !verified.payload) return false;
    _revokedSessionIds.set(verified.payload.sid, verified.payload.exp);
    return true;
  },

  /**
   * Extracts session token from HttpOnly cookie, x-gate-session header, or Bearer ppgs1... header.
   */
  extractSessionTokenFromRequest(req: express.Request): string | null {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const candidate = authHeader.slice(7).trim();
      if (candidate.startsWith(`${SESSION_TOKEN_PREFIX}.`)) {
        return candidate;
      }
    }

    const sessionHeader = req.headers['x-gate-session'];
    if (typeof sessionHeader === 'string' && sessionHeader.trim().startsWith(`${SESSION_TOKEN_PREFIX}.`)) {
      return sessionHeader.trim();
    }

    const cookies = parseCookies(req.headers.cookie);
    if (cookies[GATE_COOKIE_NAME]) {
      return cookies[GATE_COOKIE_NAME];
    }

    return null;
  },

  setSessionCookie(res: express.Response, req: express.Request, sessionToken: string, maxAgeSeconds: number): void {
    const attrs = [
      `${GATE_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
      'Path=/api',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    ];
    if (isSecureRequest(req)) {
      attrs.push('Secure');
    }
    res.setHeader('Set-Cookie', attrs.join('; '));
  },

  clearSessionCookie(res: express.Response, req: express.Request): void {
    const attrs = [
      `${GATE_COOKIE_NAME}=`,
      'Path=/api',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=0',
    ];
    if (isSecureRequest(req)) {
      attrs.push('Secure');
    }
    res.setHeader('Set-Cookie', attrs.join('; '));
  },

  /**
   * Non-mutating check to see whether a key has already exhausted its window quota.
   */
  isRateLimited(params: {
    namespace: string;
    key: string;
    maxRequests: number;
  }): {
    limited: boolean;
    retryAfterSeconds: number;
  } {
    const now = Date.now();
    pruneExpiredState(now);
    const compositeKey = `${params.namespace}:${params.key}`;
    const existing = _rateLimitBuckets.get(compositeKey);
    if (!existing || existing.resetAt <= now || existing.count < params.maxRequests) {
      return { limited: false, retryAfterSeconds: 0 };
    }
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  },

  /**
   * Fixed-window per-key rate limiter.
   */
  consumeRateLimit(params: {
    namespace: string;
    key: string;
    maxRequests: number;
    windowMs: number;
  }): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  } {
    const now = Date.now();
    pruneExpiredState(now);

    const compositeKey = `${params.namespace}:${params.key}`;
    const existing = _rateLimitBuckets.get(compositeKey);

    if (!existing || existing.resetAt <= now) {
      _rateLimitBuckets.set(compositeKey, {
        count: 1,
        resetAt: now + params.windowMs,
      });
      return {
        allowed: true,
        remaining: Math.max(0, params.maxRequests - 1),
        retryAfterSeconds: 0,
      };
    }

    if (existing.count >= params.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, params.maxRequests - existing.count),
      retryAfterSeconds: 0,
    };
  },

  clearRateLimitKey(namespace: string, key: string): void {
    _rateLimitBuckets.delete(`${namespace}:${key}`);
  },

  /**
   * Scrubs any configured server passcodes, session secrets, webhook secrets, or service-role keys from diagnostic output.
   */
  redactServerSecrets(text: string): string {
    if (!text) return '';
    let scrubbed = text;
    const secrets = [
      sanitizeSecret(process.env.GATE_PASSCODE),
      sanitizeSecret(process.env.ADMIN_PASSCODE),
      sanitizeSecret(process.env.GATE_SESSION_SECRET),
      sanitizeSecret(process.env.SUPABASE_SERVICE_ROLE_KEY),
      sanitizeSecret(process.env.RELWORX_API_KEY),
      sanitizeSecret(process.env.RELWORX_WEBHOOK_SECRET),
    ].filter((s) => s.length >= 4);

    for (const secret of secrets) {
      scrubbed = scrubbed.split(secret).join('[REDACTED]');
    }
    scrubbed = scrubbed.replace(/ppgs1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'ppgs1.[REDACTED]');
    return scrubbed;
  },

  resetStateForTests(): void {
    _revokedSessionIds.clear();
    _rateLimitBuckets.clear();
  },
};

import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// ══════════════════════════════════════════════════════════════════════════
// ADMIN AUTH
//
// Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD in `.env.local`.
//
// This used to read `process.env.ADMIN_PASSWORD || <a literal default>` — that
// was committed to git and baked into the packaged Electron build, while
// `.gitignore` ignores `.env*` — so the fallback *was* the live credential,
// guarding routes that can spawn processes (/api/admin/control) and write
// files (/api/admin/frontend-config). There is no fallback any more: with the
// env vars unset or too short, every login is refused and the reason is logged.
//
// Session state deliberately stays in this module's `sessions` Map. The other
// /api/admin/* routes verify by calling this endpoint back over HTTP rather
// than importing the Map, because Next bundles each route handler separately
// and a module-scoped Map can be duplicated per bundle. See ./session.ts.
// ═════════════════════════════════════════════════════════════════════════

const SESSION_COOKIE = "admin_session";

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

// Rejected even when set, so "I configured the env var" can't quietly mean
// "I configured it to something brute-forceable".
const MIN_ADMIN_PASSWORD_LENGTH = 12;

// Upper bound on accepted credential length. Without this, a client could
// force us to SHA-256 an arbitrarily large `password` before rejecting it.
const MAX_CREDENTIAL_LENGTH = 512;

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_LOGIN_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface AdminSession {
  username: string;
  createdAt: number;
}

// token -> session, and client IP -> timestamps of recent failed attempts.
// In-memory on purpose: a restart invalidates every session, and exactly one
// server process exists in the local/LAN/Electron setups this app targets.
const sessions = new Map<string, AdminSession>();
const failedAttempts = new Map<string, number[]>();

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Constant-time string comparison. Both sides are hashed first so the buffers
 * are always 32 bytes: `timingSafeEqual` THROWS on mismatched lengths, so
 * comparing the raw strings would both crash on a wrong-length guess and leak
 * the real password's length through the resulting error.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

type ConfigCheck = { ok: true } | { ok: false; reason: string };

/** Refuses to serve logins with unset or trivially short credentials. */
function checkAdminConfig(): ConfigCheck {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return { ok: false, reason: 'ADMIN_NOT_CONFIGURED' };
  if (ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return { ok: false, reason: 'ADMIN_PASSWORD_TOO_SHORT' };
  }
  return { ok: true };
}

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/** True once this client has spent its recent failed-attempt budget. */
function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (failedAttempts.get(key) || []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  if (recent.length === 0) {
    failedAttempts.delete(key);
    return false;
  }
  failedAttempts.set(key, recent);
  return recent.length >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const recent = (failedAttempts.get(key) || []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  recent.push(now);
  failedAttempts.set(key, recent);
}

function clearFailedAttempts(key: string): void {
  failedAttempts.delete(key);
}

/** Drops expired sessions so the Map can't grow without bound. */
function sweepExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
}

function getSession(request: NextRequest): { username: string } | null {
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) return null;
  const session = sessions.get(sessionCookie);
  if (!session) return null;
  
  // Sessions expire after 12 hours
  const maxAge = SESSION_TTL_MS;
  if (Date.now() - session.createdAt > maxAge) {
    sessions.delete(sessionCookie);
    return null;
  }
  
  return { username: session.username };
}

export async function POST(request: NextRequest) {
  const key = clientKey(request);

  try {
    const body = await request.json();
    const { username, password, action } = body;

    // Logout
    if (action === 'logout') {
      const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
      if (sessionCookie) sessions.delete(sessionCookie);
      const response = NextResponse.json({ success: true });
      response.cookies.set(SESSION_COOKIE, '', { 
        httpOnly: true, 
        sameSite: 'lax', 
        path: '/',
        maxAge: 0 
      });
      return response;
    }

    // Only login is gated on configuration — logout above must keep working,
    // otherwise a half-configured server can't even clear a stale cookie.
    const config = checkAdminConfig();
    if (!config.ok) {
      console.error(
        `[admin-auth] refusing logins: ${config.reason}. ` +
          `Set ADMIN_USERNAME and ADMIN_PASSWORD (min ${MIN_ADMIN_PASSWORD_LENGTH} chars) ` +
          `in .env.local — see .env.example.`
      );
      return NextResponse.json({ success: false, error: config.reason }, { status: 503 });
    }

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'MISSING_CREDENTIALS' }, { status: 400 });
    }

    if (isRateLimited(key)) {
      return NextResponse.json(
        { success: false, error: 'TOO_MANY_ATTEMPTS' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(ATTEMPT_WINDOW_MS / 1000)) },
        }
      );
    }

    // Bound the work before hashing. Rejecting oversized input up front is not
    // a secret-dependent branch, so it can't be used as a timing oracle.
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username.length > MAX_CREDENTIAL_LENGTH ||
      password.length > MAX_CREDENTIAL_LENGTH
    ) {
      recordFailedAttempt(key);
      return NextResponse.json({ success: false, error: 'INVALID_CREDENTIALS' }, { status: 401 });
    }

    // Both comparisons always evaluate — never short-circuit — so a wrong
    // username and a wrong password take the same time to reject.
    const userOk = safeEqual(username, ADMIN_USERNAME);
    const pwOk = safeEqual(password, ADMIN_PASSWORD);
    
    if (!userOk || !pwOk) {
      recordFailedAttempt(key);
      return NextResponse.json({ success: false, error: 'INVALID_CREDENTIALS' }, { status: 401 });
    }

    clearFailedAttempts(key);
    sweepExpiredSessions();

    const token = generateToken();
    sessions.set(token, { username, createdAt: Date.now() });

    const response = NextResponse.json({ success: true, username });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      // Only sent over HTTPS. Left off in development so http://localhost and
      // http://<LAN-IP>:3000 keep working during testing.
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000, // seconds
    });

    return response;
  } catch {
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, username: session.username });
}


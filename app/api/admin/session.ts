import { NextRequest } from "next/server";

// ═════════════════════════════════════════════════════════════════════════
// SHARED ADMIN SESSION VERIFICATION
//
// This exact function used to be copy-pasted into five separate routes
// (control, frontend-config, service-status, tmdb-config,
// tmdb-config/restart), each with the same two bugs:
//
//   1. A hardcoded LAN IP — `http://192.168.86.75:${process.env.PORT || 3001}`.
//      That is wrong for `npm run dev` (the README and the Electron config both
//      use port 3000) and wrong on every machine that isn't this one. All five
//      would report a valid session as unauthenticated.
//   2. `await res.json()` with no guard on a non-JSON error page, inside a
//      bare `catch {}` — so a genuinely broken auth service looked identical
//      to an expired session.
//
// WHY THIS STILL CALLS BACK OVER HTTP INSTEAD OF IMPORTING THE SESSIONS MAP:
// Next bundles each route handler as its own entry point, so a module-scoped
// `Map` shared between them can end up duplicated per bundle. HTTP
// self-verification against the single /api/admin/auth route is what keeps
// one authoritative session store, and it is preserved here deliberately.
//
// The base URL now defaults to the incoming request's own origin, which is
// correct for localhost, LAN and the Electron shell without any configuration.
// ══════════════════════════════════════════════════════════════════════════

const SESSION_COOKIE = "admin_session";

/**
 * Resolves the base URL to call back on. Prefers an explicit override so
 * deployments behind a proxy that rewrites Host can pin it, otherwise uses
 * the origin the client actually reached us on.
 */
function adminAuthBaseUrl(request: NextRequest): string {
  const configured = (process.env.ADMIN_INTERNAL_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return request.nextUrl.origin;
}

/**
 * True when the request carries a live admin session. Fails closed: any
 * network error, non-JSON body or non-2xx response is treated as "not
 * authenticated".
 */
export async function verifyAdminSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;

  try {
    const res = await fetch(`${adminAuthBaseUrl(request)}/api/admin/auth`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: "no-store",
    });
    if (!res.ok) return false;

    const data = await res.json().catch(() => null);
    return data?.authenticated === true;
  } catch {
    return false;
  }
}

/** The 401 body every admin route already returned, kept identical. */
export function unauthorizedResponse() {
  return { success: false, error: "UNAUTHORIZED" };
}
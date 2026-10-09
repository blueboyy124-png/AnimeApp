// ═════════════════════════════════════════════════════════════════════════
// PUBLIC RUNTIME CONFIG
//
// The single place every module reads env-backed values from.
//
// WHY THIS EXISTS: the same TMDB key used to be written as a string literal
// in five different files, and those files disagreed about what to do when
// the env var was missing — one silently substituted the old literal, one
// returned "" and bailed early, one sent an empty key upstream. A missing
// value now has exactly one behaviour everywhere: report it once, in one
// place, and let the caller decide how to degrade.
//
// ️  NEXT.JS ENV INLINING — READ BEFORE REFACTORING
// `process.env.NEXT_PUBLIC_*` is replaced with its literal value at BUILD
// time. That substitution only happens for literal member access
// (`process.env.FOO`), never for dynamic indexing (`process.env[name]`) —
// see node_modules/next/dist/docs/01-app/02-guides/environment-variables.md
// ("dynamic lookups will not be inlined"). Every read below therefore uses a
// literal member expression on purpose. Do NOT rewrite them into a loop or a
// `const env = process.env` alias: the values would silently become
// `undefined` in the browser bundle while still working on the server.
//
// ⚠️  Everything in this file is PUBLIC. Anything prefixed NEXT_PUBLIC_ is
// inlined into the client bundle and readable in devtools -> Sources. Never
// add a secret here; server-only secrets belong in the route handlers that
// use them.
// ══════════════════════════════════════════════════════════════════════════

function clean(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

// ── API keys ──────────────────────────────────────────────────────────────
export const TMDB_API_KEY = clean(process.env.NEXT_PUBLIC_TMDB_API_KEY);
export const OMDB_API_KEY = clean(process.env.NEXT_PUBLIC_OMDB_API_KEY);

// ── Supabase (client + anon key; protected by row-level security, not by
//    secrecy). The literal project URL/anon key that used to live in
//    utils/supabase.ts as a build-time fallback have been removed — a
//    "works on my machine" fallback that silently pointed every deployment
//    at one developer's Supabase project.
export const SUPABASE_URL = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// ── Static endpoints ─────────────────────────────────────────────────────
export const TMDB_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMG = "https://image.tmdb.org/t/p";

// ── Missing-config reporting ─────────────────────────────────────────────
// Presence is captured here, from the constants above, rather than by
// re-reading process.env dynamically (which wouldn't be inlined — see above).
const CONFIG_ENTRIES: ReadonlyArray<{ name: string; present: boolean }> = [
  { name: "NEXT_PUBLIC_TMDB_API_KEY", present: !!TMDB_API_KEY },
  { name: "NEXT_PUBLIC_OMDB_API_KEY", present: !!OMDB_API_KEY },
  { name: "NEXT_PUBLIC_SUPABASE_URL", present: !!SUPABASE_URL },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", present: !!SUPABASE_ANON_KEY },
];

/** Names of the public env vars that are not set. Empty array == fully configured. */
export function missingPublicConfig(): string[] {
  return CONFIG_ENTRIES.filter((entry) => !entry.present).map((entry) => entry.name);
}

export function isTmdbConfigured(): boolean {
  return !!TMDB_API_KEY;
}

const warnedScopes = new Set<string>();

/**
 * Warns at most once per `scope` that public config is incomplete, and
 * returns whether everything required is present. Call this at the start of
 * any code path that depends on these values so a misconfigured environment
 * surfaces as one clear console message instead of a cascade of confusing
 * empty results.
 */
export function warnIfPublicConfigMissing(scope: string): boolean {
  const missing = missingPublicConfig();
  if (missing.length === 0) return true;

  if (!warnedScopes.has(scope)) {
    warnedScopes.add(scope);
    console.warn(
      `[config] ${scope}: missing ${missing.join(", ")}. ` +
        `Copy .env.example to .env.local and fill it in — see README.`
    );
  }
  return false;
}
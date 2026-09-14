// Detect whether we're running inside the Electron desktop app. The
// Capacitor Electron shell doesn't set any bare-standard flag, so we check
// for the custom preload bridge we expose in electron/src/preload.ts.
export function isElectron(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    (window as any).electronAPI ||
    (window as any).isElectron ||
    (typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent))
  );
}

// Default LAN host for the anime API. Overridable via NEXT_PUBLIC_API_URL.
// Kept as a single constant so it's not duplicated across branches.
const DEFAULT_API_HOST = "192.168.86.75";

export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  // Electron dock app: the backends are spawned locally by Electron itself on
  // 127.0.0.1 — never point at a LAN IP that won't exist on other machines.
  if (typeof window !== "undefined" && isElectron()) {
    return "http://127.0.0.1:3000/api";
  }

  return `http://${DEFAULT_API_HOST}:3000/api`;
}

/**
 * The TMDB Embed API is a separate service from the anime API above. Keep its
 * origin configurable so a phone or deployed site does not accidentally point
 * at its own 192.168.86.75 instead of the machine running the stream providers.
 * In Electron, the TMDB-Embed-API is spawned locally on 127.0.0.1:8787.
 */
export function getTmdbEmbedApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_TMDB_EMBED_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && isElectron()) {
    return "http://127.0.0.1:8787";
  }

  return `http://${DEFAULT_API_HOST}:8787`;
}
import {
  SOURCE_CACHE_KEY,
  PERSISTENT_SOURCE_CACHE_KEY,
} from "./constants";

export function loadPersistentSourceCache(): Record<string, any> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PERSISTENT_SOURCE_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function savePersistentSourceCache(cache: Record<string, any>): void {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(cache);
    if (keys.length > 100) {
      keys
        .sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0))
        .slice(0, keys.length - 100)
        .forEach((k) => delete cache[k]);
    }
    localStorage.setItem(PERSISTENT_SOURCE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full/unavailable — non-fatal
  }
}

export function loadSourceCache(): Record<string, any> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(SOURCE_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveSourceCache(cache: Record<string, any>): void {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(cache);
    if (keys.length > 30) {
      keys
        .sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0))
        .slice(0, keys.length - 30)
        .forEach((k) => delete cache[k]);
    }
    sessionStorage.setItem(SOURCE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // sessionStorage full/unavailable — non-fatal
  }
}

export function invalidateFailedSource(failedUrl: string): void {
  if (typeof window === "undefined" || !failedUrl) return;
  try {
    const sourceCandidates = new Set([failedUrl]);
    try {
      const parsed = new URL(failedUrl, window.location.origin);
      const upstream = parsed.searchParams.get("url");
      if (upstream) sourceCandidates.add(upstream);
    } catch {}
    const session = loadSourceCache();
    let sessionChanged = false;
    for (const key of Object.keys(session)) {
      if (sourceCandidates.has(session[key]?.streamUrl)) {
        delete session[key];
        sessionChanged = true;
      }
    }
    if (sessionChanged) saveSourceCache(session);

    const persistent = loadPersistentSourceCache();
    let persistentChanged = false;
    for (const key of Object.keys(persistent)) {
      const entry = persistent[key];
      if (sourceCandidates.has(entry?.streamUrl) || sourceCandidates.has(entry?.url)) {
        delete persistent[key];
        persistentChanged = true;
      }
    }
    if (persistentChanged) savePersistentSourceCache(persistent);
  } catch {
    // Cache invalidation is best effort; playback fallback remains authoritative.
  }
}

export function markSourceHealthy(sourceUrl: string): void {
  if (typeof window === "undefined" || !sourceUrl) return;
  const mark = (cache: Record<string, any>) => {
    let changed = false;
    for (const entry of Object.values(cache)) {
      if (entry?.streamUrl === sourceUrl || entry?.url === sourceUrl) {
        entry.healthy = true;
        changed = true;
      }
    }
    return changed;
  };
  try {
    const session = loadSourceCache();
    if (mark(session)) saveSourceCache(session);
    const persistent = loadPersistentSourceCache();
    if (mark(persistent)) savePersistentSourceCache(persistent);
  } catch {}
}

export function getCachedSource(..._args: any[]): any { return null; }
export function cacheSource(..._args: any[]): void {}
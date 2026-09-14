// ════════════════════════════════════════════════════════════════════════════
// TMDB ID RESOLVER
//
// One place to get a TMDB ID for ANY media the watch page can show:
//   - "anime"  → title search constrained to Animation (genre 16), with
//                year / exact-name disambiguation (fixes same-name remakes)
//   - "movie"  → title search with release-year disambiguation
//   - "tv"     → title search with first-air-year disambiguation
//   - any      → an explicit TMDB ID (movies/TV URLs already carry one)
//                passes straight through.
//
// The result is cached (memory + localStorage, 7-day TTL) so repeated page
// loads don't re-hit TMDB, and identical concurrent requests share one
// in-flight promise. Results are meant to be trusted and reused — the
// resolver is designed as the foundation for other TMDB-backed features.
//
// CLIENT-SAFE: uses only fetch + guarded localStorage, no node APIs.
// ════════════════════════════════════════════════════════════════════════════

export const TMDB_API_KEY =
  process.env.NEXT_PUBLIC_TMDB_API_KEY || "e0554f6521da4365d4a36ea7ff17ae51";
export const TMDB_IMG = "https://image.tmdb.org/t/p";
const TMDB_BASE = "https://api.themoviedb.org/3";

export async function tmdbFetch(path: string): Promise<{ ok: boolean; data: any }> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_API_KEY}&language=en-US`);
  const data = await res.json();
  return { ok: res.ok, data };
}

export type ResolveMediaKind = "anime" | "movie" | "tv";

export interface ResolveTmdbIdInput {
  /** What kind of media this is. Anime resolves to a TMDB "tv" entry. */
  kind: ResolveMediaKind;
  /** Known TMDB ID (e.g. parsed from a URL) — passes through untouched. */
  tmdbId?: string | number | null;
  /** Primary title to search for (anime: english title, romaji fallback). */
  title?: string | null;
  /** Alternate title to try if the primary search comes up empty. */
  altTitle?: string | null;
  /** Release (movie) or first-air (tv/anime) year for disambiguation. */
  year?: number | null;
  /** Optional AniList ID — only used to key the cache for anime. */
  anilistId?: string | null;
}

export interface TmdbIdResult {
  tmdbId: string;
  /** "anime" inputs always resolve to a "tv" entry. */
  kind: "movie" | "tv";
  /** How the match was made — lets callers decide how much to trust it. */
  matchedBy: "explicit" | "cache" | "year" | "exact-title" | "animation-genre" | "top-result";
}

// ─── Caching (memory + localStorage, 7-day TTL) ──────────────────────────────
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LS_CACHE_KEY = "tmdbIdResolver:v1";
const memoryCache = new Map<string, TmdbIdResult>();
const inFlight = new Map<string, Promise<TmdbIdResult | null>>();

function cacheKeyFor(input: ResolveTmdbIdInput): string {
  const idPart = input.tmdbId != null ? `id:${input.tmdbId}` : "";
  const t = (input.title || "").trim().toLowerCase();
  const a = (input.altTitle || "").trim().toLowerCase();
  return [input.kind, idPart, t, a, input.year ?? "", input.anilistId ?? ""].join("|");
}

function readLsCache(): Record<string, { result: TmdbIdResult; ts: number }> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LS_CACHE_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLsCacheEntry(key: string, entry: { result: TmdbIdResult; ts: number }) {
  try {
    if (typeof window === "undefined") return;
    const cache = readLsCache();
    cache[key] = entry;
    // Keep the cache bounded — drop the oldest entries past 300.
    const keys = Object.keys(cache);
    if (keys.length > 300) {
      keys
        .sort((x, y) => (cache[x]?.ts ?? 0) - (cache[y]?.ts ?? 0))
        .slice(0, keys.length - 300)
        .forEach((k) => delete cache[k]);
    }
    window.localStorage.setItem(LS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage unavailable (private mode / blocked cookies) — memory cache still works.
  }
}

function getCachedResult(key: string): TmdbIdResult | null {
  const mem = memoryCache.get(key);
  if (mem) return mem;
  const ls = readLsCache()[key];
  if (ls && Date.now() - ls.ts < CACHE_TTL_MS) {
    memoryCache.set(key, ls.result);
    return ls.result;
  }
  return null;
}

// ─── Search helpers ──────────────────────────────────────────────────────────

function yearOf(dateStr: string | undefined | null): number | null {
  if (!dateStr || dateStr.length < 4) return null;
  const y = parseInt(dateStr.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

async function searchTmdb(endpoint: string, params: string) {
  const { ok, data } = await tmdbFetch(`/search/${endpoint}?${params}`);
  if (!ok) return [];
  return Array.isArray(data?.results) ? data.results : [];
}

/**
 * Resolve a TMDB ID for any media type. Returns null when nothing
 * confident enough was found (callers should degrade gracefully).
 */
export async function resolveTmdbId(input: ResolveTmdbIdInput): Promise<TmdbIdResult | null> {
  const key = cacheKeyFor(input);

  // Explicit IDs are trusted as-is (movies/TV URLs already carry one).
  if (input.tmdbId != null && /^\d+$/.test(String(input.tmdbId))) {
    const result: TmdbIdResult = {
      tmdbId: String(input.tmdbId),
      kind: input.kind === "movie" ? "movie" : "tv",
      matchedBy: "explicit",
    };
    memoryCache.set(key, result);
    writeLsCacheEntry(key, { result, ts: Date.now() });
    return result;
  }

  const cached = getCachedResult(key);
  if (cached) return cached;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<TmdbIdResult | null> => {
    const title = (input.title || "").trim();
    const altTitle = (input.altTitle || "").trim();
    if (!title && !altTitle) return null;

    if (input.kind === "movie") {
      const yearParam = input.year ? `&year=${input.year}` : "";
      const results = await searchTmdb(
        "movie",
        `query=${encodeURIComponent(title)}${yearParam}&include_adult=false`
      );
      if (results.length === 0 && altTitle) {
        results.push(...(await searchTmdb(
          "movie",
          `query=${encodeURIComponent(altTitle)}${yearParam}&include_adult=false`
        )));
      }
      if (results.length === 0) return null;
      const exact = results.find(
        (r: any) => (r.title || "").toLowerCase() === title.toLowerCase()
      );
      const best = exact || results[0];
      return {
        tmdbId: String(best.id),
        kind: "movie",
        matchedBy: exact ? "exact-title" : input.year ? "year" : "top-result",
      };
    }

    // "tv" and "anime" both resolve against TMDB TV entries.
    const yearParam = input.year && input.kind === "tv" ? `&first_air_date_year=${input.year}` : "";
    let results = await searchTmdb("tv", `query=${encodeURIComponent(title)}${yearParam}&include_adult=false`);
    if (results.length === 0 && altTitle) {
      results = await searchTmdb("tv", `query=${encodeURIComponent(altTitle)}${yearParam}&include_adult=false`);
    }
    if (results.length === 0) return null;

    if (input.kind === "anime") {
      // Constrain to Animation entries when any exist, then disambiguate:
      // year match beats exact name beats top result.
      const animated = results.filter(
        (r: any) => Array.isArray(r.genre_ids) && r.genre_ids.includes(16)
      );
      const pool = animated.length > 0 ? animated : results;
      const byYear = input.year
        ? pool.find((r: any) => yearOf(r.first_air_date) === input.year)
        : null;
      const byExact = pool.find(
        (r: any) => (r.name || "").toLowerCase() === title.toLowerCase()
      ) ||
        (altTitle
          ? pool.find((r: any) => (r.name || "").toLowerCase() === altTitle.toLowerCase())
          : null);
      const best = byYear || byExact || pool[0];
      return {
        tmdbId: String(best.id),
        kind: "tv",
        matchedBy: byYear ? "year" : byExact ? "exact-title" : animated.length > 0 ? "animation-genre" : "top-result",
      };
    }

    // Plain TV: exact name beats top result.
    const exact = results.find((r: any) => (r.name || "").toLowerCase() === title.toLowerCase());
    const best = exact || results[0];
    return {
      tmdbId: String(best.id),
      kind: "tv",
      matchedBy: exact ? "exact-title" : "top-result",
    };
  })();

  inFlight.set(key, promise);
  try {
    const result = await promise;
    if (result) {
      memoryCache.set(key, result);
      writeLsCacheEntry(key, { result, ts: Date.now() });
    }
    return result;
  } finally {
    inFlight.delete(key);
  }
}

// ─── Shared season mapping ───────────────────────────────────────────────────
// The watch page previously duplicated this mapping in three places. One
// canonical version lives here: real, numbered seasons only, ordered, with
// cumulative absolute episode offsets for flat-numbered (anime) providers.
export interface ResolvedTmdbSeason {
  number: number;
  name: string;
  poster?: string;
  episodeCount: number;
  absoluteOffset: number;
}

export function mapTmdbSeasons(
  rawSeasons: any[],
  opts: { posterSize?: string; absoluteOffsets?: boolean } = {}
): ResolvedTmdbSeason[] {
  const real = (rawSeasons || [])
    .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
    .sort((a: any, b: any) => a.season_number - b.season_number);
  const size = opts.posterSize || "w400";
  let cumulative = 0;
  return real.map((s: any) => {
    const info: ResolvedTmdbSeason = {
      number: s.season_number,
      name: s.name || `Season ${s.season_number}`,
      poster: s.poster_path ? `${TMDB_IMG}/${size}${s.poster_path}` : undefined,
      episodeCount: s.episode_count,
      absoluteOffset: opts.absoluteOffsets === false ? 0 : cumulative,
    };
    cumulative += s.episode_count;
    return info;
  });
}

/** Fetch one season's episodes from an already-resolved TMDB TV ID. */
export async function fetchTmdbSeason(tmdbId: string | number, season: number | string) {
  return tmdbFetch(`/tv/${tmdbId}/season/${season}`);
}


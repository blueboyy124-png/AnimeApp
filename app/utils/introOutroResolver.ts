// ════════════════════════════════════════════════════════════════════════════
// INTRO/OUTRO (SKIP INTERVAL) RESOLVER
//
// One place that decides where a video's intro/outro segments are, for ANY
// media type. Chain, in order:
//
//   1. TheIntroDB v3  — `api.theintrodb.org/v3/media?tmdb_id=<SHOW id>
//      &season=S&episode=E&duration_ms=<runtime>` (movies: no season/episode).
//      Works for movies, TV and anime alike, as long as we have a TMDB id
//      (resolved via utils/tmdbIdResolver when the caller doesn't have one).
//   2. AniSkip        — anime only, keyed off the AniList → MAL id, including
//      the One Piece MAL split table (absolute episode → per-series MAL id).
//      Non-anime skips this step entirely.
//   3. Placeholders   — conventional 90-180s OP / last-2-min ED estimates.
//
// Returns the page's SkipIntervalItem shape (seconds), so the existing skip
// button / auto-skip / auto-next UI consumes it unchanged.
// CLIENT-SAFE: fetch + guarded localStorage only.
// ════════════════════════════════════════════════════════════════════════════

import { resolveTmdbId } from "./tmdbIdResolver";
import { getApiBaseUrl } from "./api";

export type SkipType = "op" | "ed";

export interface SkipIntervalItem {
  skipId: string;
  skipType: SkipType;
  interval: { startTime: number; endTime: number };
  source: string;
  confidence: number;
  episodeLength: number;
}

export interface SkipResolutionInput {
  kind: "anime" | "movie" | "tv";
  /** TMDB *show* id if the caller already resolved one. */
  tmdbShowId?: string | number | null;
  /** Title (used to resolve the TMDB id when tmdbShowId is absent). */
  title?: string | null;
  altTitle?: string | null;
  year?: number | null;
  /** AniList id — enables the AniSkip fallback (anime only). */
  anilistId?: string | null;
  /** TMDB-aligned season/episode (callers may remap absolute numbering). */
  season?: number;
  episode?: number;
  durationSeconds: number;
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

// Legacy AniSkip/introdb.com shape: seconds-based, one interval per entry.
export function normalizeSkipIntervals(
  rawItems: any[],
  episodeLength: number,
  source: string
): SkipIntervalItem[] {
  const deduped = new Map<string, SkipIntervalItem>();
  for (const raw of rawItems || []) {
    const normalizedType = String(
      raw?.skipType ?? raw?.type ?? raw?.skip_type ?? raw?.category ?? raw?.kind ?? ""
    ).toLowerCase();
    const skipType: SkipType | null = normalizedType.includes("ed")
      ? "ed"
      : normalizedType.includes("op")
        ? "op"
        : null;
    const startTime = Number(
      raw?.interval?.startTime ?? raw?.interval?.start ?? raw?.startTime ?? raw?.start ?? raw?.start_time ?? raw?.from ?? raw?.fromTime
    );
    const endTime = Number(
      raw?.interval?.endTime ?? raw?.interval?.end ?? raw?.endTime ?? raw?.end ?? raw?.end_time ?? raw?.to ?? raw?.toTime
    );
    if (!skipType || !Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
    if (endTime <= startTime || startTime < 0 || endTime > Math.max(episodeLength + 30, 1)) continue;
    const item: SkipIntervalItem = {
      skipId: `${source}-${skipType}-${Math.round(startTime)}-${Math.round(endTime)}`,
      skipType,
      interval: { startTime, endTime },
      source,
      confidence: Number(raw?.confidence ?? raw?.confidenceScore ?? 0.8) || 0.8,
      episodeLength,
    };
    deduped.set(item.skipId, item);
  }
  return Array.from(deduped.values()).sort((a, b) => a.interval.startTime - b.interval.startTime);
}

// TheIntroDB v3 shape (per docs): intro/recap/credits/preview are ARRAYS of
// {start_ms, end_ms} where either side can be null ("from start"/"to end").
// intro+recap fold into "op" (Skip Intro); credits fold into "ed" (Skip Outro
// / auto-next); preview is ignored. All values come back in ms → /1000.
export function normalizeTheIntroDbV3(payload: any, episodeLengthSeconds: number): SkipIntervalItem[] {
  const items: SkipIntervalItem[] = [];
  const pushGroup = (group: any[] | undefined, skipType: SkipType) => {
    (group || []).forEach((seg: any, i: number) => {
      const startTime = typeof seg?.start_ms === "number" ? seg.start_ms / 1000 : 0;
      const endTime = typeof seg?.end_ms === "number" ? seg.end_ms / 1000 : episodeLengthSeconds;
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return;
      if (endTime > Math.max(episodeLengthSeconds + 30, 1)) return;
      items.push({
        skipId: `theintrodb-${skipType}-${i}-${Math.round(startTime)}-${Math.round(endTime)}`,
        skipType,
        interval: { startTime, endTime },
        source: "theintrodb",
        confidence: 0.9,
        episodeLength: episodeLengthSeconds,
      });
    });
  };
  pushGroup(payload?.intro, "op");
  pushGroup(payload?.recap, "op");
  pushGroup(payload?.credits, "ed");
  return items.sort((a, b) => a.interval.startTime - b.interval.startTime);
}

// ─── Placeholders (the "still nothing" tier) ─────────────────────────────────
export function buildConventionalFallbackIntervals(
  episodeLength: number,
  episodeNumber: number
): SkipIntervalItem[] {
  const isFirstEpisode = Math.floor(episodeNumber) === 1;
  const fallbackSet: SkipIntervalItem[] = [];
  if (!isFirstEpisode && episodeLength > 300) {
    fallbackSet.push({
      skipId: "fallback-op",
      skipType: "op",
      interval: { startTime: 90, endTime: 180 },
      source: "fallback",
      confidence: 0.65,
      episodeLength,
    });
  }
  if (episodeLength > 240) {
    fallbackSet.push({
      skipId: "fallback-ed",
      skipType: "ed",
      interval: { startTime: episodeLength - 120, endTime: episodeLength - 30 },
      source: "fallback",
      confidence: 0.65,
      episodeLength,
    });
  }
  return fallbackSet;
}

// ─── AniSkip fallback (anime only) ───────────────────────────────────────────
// AniSkip keys off MyAnimeList ids, so resolve AniList → MAL first. One Piece's
// flat absolute episode numbering (1..1100+) spans several MAL entries, which
// the split table below remaps so AniSkip receives the per-series episode
// number it actually knows about.
const ONE_PIECE_MAL_SPLIT: Array<{ maxAbsolute: number; malId: number; offset: number }> = [
  { maxAbsolute: 206, malId: 21, offset: 0 },
  { maxAbsolute: 516, malId: 459, offset: 206 },
  { maxAbsolute: 891, malId: 918, offset: 516 },
  { maxAbsolute: 1084, malId: 38234, offset: 891 },
  { maxAbsolute: Infinity, malId: 56715, offset: 1084 },
];

async function fetchMalId(anilistId: number): Promise<number | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/info/${anilistId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const raw =
      data?.results?.malId ?? data?.results?.idMal ?? data?.malId ?? data?.idMal ??
      data?.results?.mal_id ?? data?.mal_id ?? "";
    const malId = parseInt(String(raw), 10);
    return Number.isFinite(malId) ? malId : null;
  } catch {
    return null;
  }
}

async function fetchAniSkipIntervals(
  anilistId: string,
  episode: number,
  episodeLength: number
): Promise<SkipIntervalItem[]> {
  const id = parseInt(anilistId, 10);
  if (!id || isNaN(id) || isNaN(episodeLength) || episodeLength <= 60) return [];

  let malId = await fetchMalId(id);
  let targetedEpisode = Math.floor(episode);

  if (malId === 21) {
    const split = ONE_PIECE_MAL_SPLIT.find((s) => targetedEpisode <= s.maxAbsolute);
    if (split) {
      malId = split.malId;
      targetedEpisode = targetedEpisode - split.offset;
    }
  }
  if (!malId || malId <= 0) return [];

  const candidateSources = [
    {
      name: "aniskip",
      url: `https://api.aniskip.com/v2/skip-times/${malId}/${targetedEpisode}?types=op&types=ed&episodeLength=${episodeLength}`,
      parser: (data: any) => {
        const rawResults = data?.results ?? data?.skipTimes ?? data?.skip_times ?? [];
        return normalizeSkipIntervals(Array.isArray(rawResults) ? rawResults : [], episodeLength, "aniskip");
      },
    },
    {
      name: "introdb",
      url: `https://introdb.com/api/v2?anilistId=${id}&episode=${targetedEpisode}&episodeLength=${episodeLength}`,
      parser: (data: any) => {
        const rawResults = data?.results ?? data?.episodes ?? data?.skipTimes ?? data?.skip_times ?? [];
        return normalizeSkipIntervals(Array.isArray(rawResults) ? rawResults : [], episodeLength, "introdb");
      },
    },
  ];

  const collected: SkipIntervalItem[] = [];
  for (const source of candidateSources) {
    try {
      const res = await fetch(source.url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      collected.push(...source.parser(data));
    } catch {
      // Ignore provider outage and continue to the next source.
    }
  }
  return Array.from(
    new Map(
      collected.map((item) => [
        `${item.skipType}:${item.interval.startTime}:${item.interval.endTime}`,
        item,
      ])
    ).values()
  ).sort((a, b) => a.interval.startTime - b.interval.startTime);
}

// ─── TheIntroDB v3 fetch (the primary source) ────────────────────────────────
async function fetchTheIntroDbIntervals(
  tmdbShowId: string,
  input: SkipResolutionInput,
  episodeLength: number
): Promise<SkipIntervalItem[]> {
  try {
    const params = new URLSearchParams({
      tmdb_id: tmdbShowId,
      duration_ms: String(Math.round(episodeLength * 1000)),
    });
    // Movies are keyed by the movie id alone; TV/anime add season+episode.
    if (input.kind !== "movie") {
      params.set("season", String(input.season ?? 1));
      params.set("episode", String(input.episode ?? 1));
    }
    const res = await fetch(`https://api.theintrodb.org/v3/media?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    return normalizeTheIntroDbV3(await res.json(), episodeLength);
  } catch {
    return [];
  }
}

// ─── Cache (memory + localStorage) ───────────────────────────────────────────
const SKIP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SKIP_LS_KEY = "streamanime_skip_cache_v3";
const skipMemoryCache = new Map<string, { intervals: SkipIntervalItem[]; ts: number }>();

function skipCacheKey(input: SkipResolutionInput, tmdbIdUsed: string | null): string {
  return [
    input.kind,
    tmdbIdUsed || input.anilistId || input.title || "",
    input.season ?? 1,
    input.episode ?? 1,
    input.durationSeconds,
  ].join(":");
}

function readSkipCache(key: string): SkipIntervalItem[] | null {
  const mem = skipMemoryCache.get(key);
  if (mem && Date.now() - mem.ts < SKIP_CACHE_TTL_MS) return mem.intervals;
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(SKIP_LS_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw)?.[key];
    if (
      entry &&
      Array.isArray(entry.intervals) &&
      Date.now() - (entry.cachedAt ?? 0) < SKIP_CACHE_TTL_MS
    ) {
      skipMemoryCache.set(key, { intervals: entry.intervals, ts: entry.cachedAt });
      return entry.intervals;
    }
  } catch {}
  return null;
}

function writeSkipCache(key: string, intervals: SkipIntervalItem[]) {
  const ts = Date.now();
  skipMemoryCache.set(key, { intervals, ts });
  try {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(SKIP_LS_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[key] = { intervals, cachedAt: ts };
    // Bounded: drop oldest entries past 200.
    const keys = Object.keys(cache);
    if (keys.length > 200) {
      keys
        .sort((x, y) => (cache[x]?.cachedAt ?? 0) - (cache[y]?.cachedAt ?? 0))
        .slice(0, keys.length - 200)
        .forEach((k) => delete cache[k]);
    }
    window.localStorage.setItem(SKIP_LS_KEY, JSON.stringify(cache));
  } catch {}
}

// ─── Public entry point ──────────────────────────────────────────────────────
/**
 * Resolve skip intervals for any media type:
 *   TheIntroDB (TMDB id) → AniSkip (AniList id, anime only) → placeholders.
 */
export async function resolveSkipIntervals(input: SkipResolutionInput): Promise<SkipIntervalItem[]> {
  const duration = Math.floor(input.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 60) return [];

  // 1. Use the caller's TMDB show id, or resolve one from the title.
  let tmdbId = input.tmdbShowId ? String(input.tmdbShowId) : null;
  if (!tmdbId && input.title) {
    const resolved = await resolveTmdbId({
      kind: input.kind,
      title: input.title,
      altTitle: input.altTitle ?? null,
      year: input.year ?? null,
      anilistId: input.anilistId ?? null,
    });
    tmdbId = resolved?.tmdbId ?? null;
  }

  const key = skipCacheKey(input, tmdbId);
  const cached = readSkipCache(key);
  if (cached) return cached;

  // 2. TheIntroDB v3 — primary source for every media type.
  if (tmdbId) {
    const intervals = await fetchTheIntroDbIntervals(tmdbId, input, duration);
    if (intervals.length > 0) {
      writeSkipCache(key, intervals);
      return intervals;
    }
  }

  // 3. AniSkip + legacy introdb.com — anime only (needs an AniList id).
  if (input.kind === "anime" && input.anilistId) {
    const intervals = await fetchAniSkipIntervals(input.anilistId, input.episode ?? 1, duration);
    if (intervals.length > 0) {
      writeSkipCache(key, intervals);
      return intervals;
    }
  }

  // 4. Placeholders — conventional OP/ED estimates.
  const fallback = buildConventionalFallbackIntervals(duration, input.episode ?? 1);
  writeSkipCache(key, fallback);
  return fallback;
}



// ══════════════════════════════════════════════════════════════════════════
// TMDB CLIENT
//
// Everything needed to build a Netflix-style feed off TMDB:
//   - trending / popular (the "always show something real" fallback tier)
//   - per-title recommendations + similar-titles (the "because you watched
//     Infinity War, here's Endgame" row)
//   - popularity normalization, shared with recommendationEngine's
//     hybridScore so "popular" means the same thing everywhere
//   - kids-safe backfill paging: filterForKids/filterMatureRatings can
//     reject a chunk of any given page, so a naive "fetch page 1, filter,
//     done" can hand back a half-empty row. This client keeps paging until
//     it has enough safe items or runs out of pages.
//
// SECURITY NOTE: TMDB_API_KEY must come from an env var, never a literal
// string in this file. Any key baked into client-side source is visible to
// anyone who opens devtools -> Sources and reads the bundle. For real
// protection this call should go through your own backend, which can hide
// the key entirely and rate-limit per-user instead of trusting the client.
// ══════════════════════════════════════════════════════════════════════════

import { filterForKids, filterMatureRatings } from "./contentFilter";
import type { StoryDNA } from "./recommendationEngine";

const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || "";
const TMDB_BASE = "https://api.themoviedb.org/3";

export type MediaType = "movie" | "tv";

export interface TmdbItem {
  id: number;
  media_type: MediaType;
  title: string; // normalized from title (movie) / name (tv)
  overview?: string;
  genres: string[]; // resolved from genre_ids via TMDB_GENRE_MAP
  popularity: number; // raw TMDB popularity (unbounded, roughly 0-3000+)
  averageScore: number; // vote_average * 10, matches recommendationEngine's 0-100 scale
  posterPath?: string | null;
  isAdult?: boolean;
  fromRecommendations?: boolean; // true if sourced from /recommendations or /similar
  releaseYear: number | null; // null when TMDB has no date on file
}

// TMDB genre IDs -> our GENRE_TRAIT_MAP keys (recommendationEngine.ts).
// A few TV-only combo genres get split across two of our trait keys since
// they don't map 1:1 (e.g. "Sci-Fi & Fantasy" nudges both).
const TMDB_GENRE_MAP: Record<number, string[]> = {
  28: ["action"],
  12: ["adventure"],
  16: ["animation"],
  35: ["comedy"],
  80: ["crime"],
  99: ["documentary"],
  18: ["drama"],
  10751: ["family"],
  14: ["fantasy"],
  36: ["history"],
  27: ["horror"],
  10402: ["music"],
  9648: ["mystery"],
  10749: ["romance"],
  878: ["science fiction"],
  53: ["thriller"],
  10752: ["war"],
  37: ["western"],
  10759: ["action", "adventure"], // TV "Action & Adventure"
  10765: ["sci-fi", "fantasy"], // TV "Sci-Fi & Fantasy"
  10768: ["war"], // TV "War & Politics"
  10762: ["family"], // TV "Kids"
};

export function normalizePopularity(rawPopularity: number): number {
  // Log-scaled so a handful of mega-blockbusters (popularity in the
  // thousands) don't make everything else round down to ~0. Denominator
  // tuned so popularity ~1000 lands close to 1.0.
  const n = Math.log10(Math.max(0, rawPopularity) + 1) / 3;
  return Math.max(0, Math.min(1, n));
}

function extractYear(dateStr: string | undefined | null): number | null {
  if (!dateStr || dateStr.length < 4) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function normalizeMovie(raw: any, fromRecommendations = false): TmdbItem {
  return {
    id: raw.id,
    media_type: "movie",
    title: raw.title || raw.original_title || "Untitled",
    overview: raw.overview,
    genres: (raw.genre_ids || raw.genres?.map((g: any) => g.id) || []).flatMap(
      (gid: number) => TMDB_GENRE_MAP[gid] || []
    ),
    popularity: raw.popularity || 0,
    averageScore: (raw.vote_average || 0) * 10,
    posterPath: raw.poster_path,
    isAdult: !!raw.adult,
    fromRecommendations,
    releaseYear: extractYear(raw.release_date),
  };
}

function normalizeTv(raw: any, fromRecommendations = false): TmdbItem {
  return {
    id: raw.id,
    media_type: "tv",
    title: raw.name || raw.original_name || "Untitled",
    overview: raw.overview,
    genres: (raw.genre_ids || raw.genres?.map((g: any) => g.id) || []).flatMap(
      (gid: number) => TMDB_GENRE_MAP[gid] || []
    ),
    popularity: raw.popularity || 0,
    averageScore: (raw.vote_average || 0) * 10,
    posterPath: raw.poster_path,
    isAdult: false, // TMDB TV payloads don't carry an `adult` flag; certification pass covers this
    fromRecommendations,
    releaseYear: extractYear(raw.first_air_date),
  };
}

async function tmdbGet(path: string): Promise<any> {
  if (!TMDB_API_KEY) {
    console.error("TMDB_API_KEY is not set (expected NEXT_PUBLIC_TMDB_API_KEY env var).");
    return { results: [] };
  }
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TMDB_BASE}${path}${sep}api_key=${TMDB_API_KEY}`);
  if (!res.ok) return { results: [] };
  return res.json();
}

async function fetchTrendingPage(mediaType: MediaType, page: number): Promise<TmdbItem[]> {
  const data = await tmdbGet(`/trending/${mediaType}/week?page=${page}`);
  const results = data.results || [];
  return mediaType === "movie" ? results.map((r: any) => normalizeMovie(r)) : results.map((r: any) => normalizeTv(r));
}

async function fetchPopularPage(mediaType: MediaType, page: number): Promise<TmdbItem[]> {
  const data = await tmdbGet(`/${mediaType}/popular?page=${page}`);
  const results = data.results || [];
  return mediaType === "movie" ? results.map((r: any) => normalizeMovie(r)) : results.map((r: any) => normalizeTv(r));
}

export async function fetchRecommendationsFor(id: number, mediaType: MediaType): Promise<TmdbItem[]> {
  const data = await tmdbGet(`/${mediaType}/${id}/recommendations`);
  const results = data.results || [];
  return mediaType === "movie"
    ? results.map((r: any) => normalizeMovie(r, true))
    : results.map((r: any) => normalizeTv(r, true));
}

export async function fetchSimilarFor(id: number, mediaType: MediaType): Promise<TmdbItem[]> {
  const data = await tmdbGet(`/${mediaType}/${id}/similar`);
  const results = data.results || [];
  return mediaType === "movie"
    ? results.map((r: any) => normalizeMovie(r, true))
    : results.map((r: any) => normalizeTv(r, true));
}

function dedupeById(items: TmdbItem[]): TmdbItem[] {
  const seen = new Set<string>();
  const out: TmdbItem[] = [];
  for (const item of items) {
    const key = `${item.media_type}-${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// "Popular or trending" as a hard requirement rather than a hope: anything
// below this normalized-popularity floor never reaches a recommendation
// row. Tune this against real usage — 0.12 roughly corresponds to TMDB
// popularity ~25, which filters out deep-catalog obscurities without also
// filtering out solid-but-not-huge titles.
const POPULARITY_FLOOR = 0.12;

export function passesPopularityFloor(item: TmdbItem): boolean {
  return normalizePopularity(item.popularity) >= POPULARITY_FLOOR;
}

// Nothing older than this ever gets recommended. A title with no date on
// file is excluded rather than assumed fine, same failure-mode philosophy
// as the kids certification check above: unknown means "don't show it",
// not "probably fine."
const MIN_RELEASE_YEAR = 1990;

export function passesReleaseYearFloor(item: TmdbItem): boolean {
  return item.releaseYear !== null && item.releaseYear >= MIN_RELEASE_YEAR;
}

// Pages through a TMDB list endpoint, running each page through the kids
// safety filters (when isKids) and the popularity floor, until it collects
// `targetCount` safe items or runs out of pages. This is what keeps a kids
// profile (or any profile, once the floor is applied) from silently ending
// up with a 3-item row just because the first page happened to skew mature
// or unpopular.
async function fetchWithBackfill(
  fetchPage: (page: number) => Promise<TmdbItem[]>,
  targetCount: number,
  isKids: boolean,
  maxPages = 5
): Promise<TmdbItem[]> {
  const collected: TmdbItem[] = [];
  let page = 1;
  while (collected.length < targetCount && page <= maxPages) {
    const raw = await fetchPage(page);
    if (raw.length === 0) break;

    const genreSafe = filterForKids(raw, isKids);
    const fullySafe = isKids ? await filterMatureRatings(genreSafe, true) : genreSafe;
    const popularEnough = fullySafe.filter(passesPopularityFloor).filter(passesReleaseYearFloor);

    collected.push(...popularEnough);
    page++;
  }
  return dedupeById(collected).slice(0, targetCount);
}

export async function fetchTrendingSafe(mediaType: MediaType, isKids: boolean, count = 20): Promise<TmdbItem[]> {
  return fetchWithBackfill((page) => fetchTrendingPage(mediaType, page), count, isKids);
}

export async function fetchPopularSafe(mediaType: MediaType, isKids: boolean, count = 20): Promise<TmdbItem[]> {
  return fetchWithBackfill((page) => fetchPopularPage(mediaType, page), count, isKids);
}

// "Because you watched X" — recommendations first (TMDB's own collaborative
// signal), topped up with /similar if recommendations come back thin, which
// happens a lot for less mainstream titles.
export async function fetchBecauseYouWatchedSafe(
  id: number,
  mediaType: MediaType,
  isKids: boolean,
  count = 15
): Promise<TmdbItem[]> {
  const recs = await fetchRecommendationsFor(id, mediaType);
  let pool = recs;
  if (pool.length < count) {
    const similar = await fetchSimilarFor(id, mediaType);
    pool = dedupeById([...pool, ...similar]);
  }

  const genreSafe = filterForKids(pool, isKids);
  const fullySafe = isKids ? await filterMatureRatings(genreSafe, true) : genreSafe;
  return fullySafe.filter(passesPopularityFloor).filter(passesReleaseYearFloor).slice(0, count);
}

export function toStoryDNAInput(item: TmdbItem): { genres: string[]; overview?: string; averageScore: number } {
  return { genres: item.genres, overview: item.overview, averageScore: item.averageScore };
}
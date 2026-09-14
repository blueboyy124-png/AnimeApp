// ══════════════════════════════════════════════════════════════════════════
// ANILIST CLIENT
//
// Mirrors tmdbClient.ts but for anime, since "recommend me stuff like what
// I watched" needs to work for anime too, not just movies/TV. AniList's
// GraphQL API is free, keyless, and already exposes isAdult + genres +
// per-title recommendations, so it needs less normalization work than TMDB.
// ══════════════════════════════════════════════════════════════════════════

import { filterForKids } from "./contentFilter";
import { normalizePopularity, passesPopularityFloor, passesReleaseYearFloor } from "./tmdbClient";
import type { TmdbItem } from "./tmdbClient";

const ANILIST_URL = "https://graphql.anilist.co";

async function anilistQuery(query: string, variables: Record<string, any>): Promise<any> {
  try {
    const res = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function normalizeAniListMedia(m: any, fromRecommendations = false): TmdbItem {
  return {
    id: m.id,
    // Reuses the TmdbItem shape (media_type is typed as "movie" | "tv" there)
    // — cast to keep this file decoupled from tmdbClient's type union so
    // adding a new media type doesn't require editing tmdbClient.ts.
    media_type: "tv" as any,
    title: m.title?.english || m.title?.romaji || "Untitled",
    overview: m.description?.replace(/<[^>]+>/g, ""), // strip AniList's inline HTML
    genres: (m.genres || []).map((g: string) => g.toLowerCase()),
    popularity: m.popularity || 0,
    averageScore: m.averageScore || 0, // already 0-100
    posterPath: m.coverImage?.large || null,
    isAdult: !!m.isAdult,
    fromRecommendations,
    releaseYear: m.startDate?.year ?? null,
  };
}

const TRENDING_QUERY = `
  query ($page: Int) {
    Page(page: $page, perPage: 25) {
      media(type: ANIME, sort: TRENDING_DESC) {
        id isAdult popularity averageScore genres
        title { english romaji }
        description(asHtml: false)
        coverImage { large }
        startDate { year }
      }
    }
  }
`;

const POPULAR_QUERY = `
  query ($page: Int) {
    Page(page: $page, perPage: 25) {
      media(type: ANIME, sort: POPULARITY_DESC) {
        id isAdult popularity averageScore genres
        title { english romaji }
        description(asHtml: false)
        coverImage { large }
        startDate { year }
      }
    }
  }
`;

const RECOMMENDATIONS_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      recommendations(sort: RATING_DESC, perPage: 15) {
        nodes {
          mediaRecommendation {
            id isAdult popularity averageScore genres
            title { english romaji }
            description(asHtml: false)
            coverImage { large }
            startDate { year }
          }
        }
      }
    }
  }
`;

async function fetchPage(query: string, page: number): Promise<TmdbItem[]> {
  const data = await anilistQuery(query, { page });
  const media = data?.data?.Page?.media || [];
  return media.map((m: any) => normalizeAniListMedia(m));
}

async function fetchWithBackfill(
  fetchPageFn: (page: number) => Promise<TmdbItem[]>,
  targetCount: number,
  isKids: boolean,
  maxPages = 4
): Promise<TmdbItem[]> {
  const collected: TmdbItem[] = [];
  let page = 1;
  while (collected.length < targetCount && page <= maxPages) {
    const raw = await fetchPageFn(page);
    if (raw.length === 0) break;
    // AniList's cert data isn't available the way TMDB's is, so kids safety
    // here rests entirely on isAdult + genre (hentai/ecchi/erotica) —
    // filterForKids from contentFilter.ts already covers exactly that.
    const safe = filterForKids(raw, isKids).filter(passesPopularityFloor).filter(passesReleaseYearFloor);
    collected.push(...safe);
    page++;
  }
  return collected.slice(0, targetCount);
}

export async function fetchTrendingAnimeSafe(isKids: boolean, count = 20): Promise<TmdbItem[]> {
  return fetchWithBackfill((page) => fetchPage(TRENDING_QUERY, page), count, isKids);
}

export async function fetchPopularAnimeSafe(isKids: boolean, count = 20): Promise<TmdbItem[]> {
  return fetchWithBackfill((page) => fetchPage(POPULAR_QUERY, page), count, isKids);
}

export async function fetchBecauseYouWatchedAnimeSafe(
  anilistId: number,
  isKids: boolean,
  count = 15
): Promise<TmdbItem[]> {
  const data = await anilistQuery(RECOMMENDATIONS_QUERY, { id: anilistId });
  const nodes = data?.data?.Media?.recommendations?.nodes || [];
  const items: TmdbItem[] = nodes
    .map((n: any) => n.mediaRecommendation)
    .filter(Boolean)
    .map((m: any) => normalizeAniListMedia(m, true));
  return filterForKids(items, isKids)
    .filter(passesPopularityFloor)
    .filter(passesReleaseYearFloor)
    .slice(0, count);
}

export { normalizePopularity };

// ══════════════════════════════════════════════════════════════════════════
// HOME FEED
//
// Ties recommendationEngine.ts (taste/scoring), contentFilter.ts (kids
// safety), tmdbClient.ts, and anilistClient.ts together into the thing that
// actually renders on the homepage: a list of Netflix-style rows.
//
// The rule this file exists to enforce: nobody ever sees a sparse or empty
// homepage. New profile, one watched title, kids profile with a small safe
// catalog after filtering — all of those fall back to trending/popular
// rows, which are always populated, instead of thin or empty personalized
// rows. Personalization is additive on top of that floor, never a
// replacement for it.
// ══════════════════════════════════════════════════════════════════════════

import {
  averageDNA,
  blendTasteForToday,
  deriveSessionMood,
  diversifyByDominantTrait,
  hybridScore,
  inferStoryDNA,
  loadPermanentTaste,
  type StoryDNA,
} from "./recommendationEngine";
import {
  fetchBecauseYouWatchedSafe,
  fetchPopularSafe,
  fetchTrendingSafe,
  normalizePopularity,
  toStoryDNAInput,
  type TmdbItem,
} from "./tmdbClient";
import {
  fetchBecauseYouWatchedAnimeSafe,
  fetchPopularAnimeSafe,
  fetchTrendingAnimeSafe,
} from "./anilistClient";

export interface WatchHistoryEntry {
  id: number;
  media_type: "movie" | "tv" | "anime";
  title: string;
  genres: string[];
  overview?: string;
  averageScore?: number;
  watchedAt: number; // epoch ms
}

export interface HomeFeedRow {
  title: string;
  items: TmdbItem[];
  reason: "trending" | "popular" | "because-you-watched" | "for-you";
}

// Below this many watched titles, taste signal is too thin to trust —
// lean on trending/popular instead of a "personalized" feed built from
// one data point. This mirrors how Netflix, Spotify, etc. handle new users:
// popularity-driven by default, personalized once there's real signal.
const COLD_START_THRESHOLD = 3;
const ROW_SIZE = 20;
const BECAUSE_YOU_WATCHED_ROWS = 3; // most-recent N watched titles get their own row

function watchedKey(w: { id: number; media_type: string }): string {
  return `${w.media_type}-${w.id}`;
}

// Always-on row: shown regardless of watch history, same as Netflix's own
// "Trending Now" row never disappearing just because you have a profile.
async function buildTrendingRow(isKids: boolean): Promise<HomeFeedRow> {
  const [movies, tv, anime] = await Promise.all([
    fetchTrendingSafe("movie", isKids, 8),
    fetchTrendingSafe("tv", isKids, 8),
    fetchTrendingAnimeSafe(isKids, 8),
  ]);
  return { title: "Trending Now", items: interleave([movies, tv, anime]), reason: "trending" };
}

async function buildPopularRows(isKids: boolean): Promise<HomeFeedRow[]> {
  const [movies, tv, anime] = await Promise.all([
    fetchPopularSafe("movie", isKids, ROW_SIZE),
    fetchPopularSafe("tv", isKids, ROW_SIZE),
    fetchPopularAnimeSafe(isKids, ROW_SIZE),
  ]);
  return [
    { title: "Popular Movies", items: movies, reason: "popular" },
    { title: "Popular TV Shows", items: tv, reason: "popular" },
    { title: "Popular Anime", items: anime, reason: "popular" },
  ];
}

// Round-robins across lists instead of concatenating them, so the row
// doesn't read as "8 movies, then 8 shows, then 8 anime" in a block.
function interleave(lists: TmdbItem[][]): TmdbItem[] {
  const out: TmdbItem[] = [];
  const max = Math.max(...lists.map((l) => l.length), 0);
  for (let i = 0; i < max; i++) {
    for (const list of lists) if (list[i]) out.push(list[i]);
  }
  return out;
}

async function buildBecauseYouWatchedRows(
  watchHistory: WatchHistoryEntry[],
  isKids: boolean
): Promise<HomeFeedRow[]> {
  const recent = [...watchHistory].sort((a, b) => b.watchedAt - a.watchedAt).slice(0, BECAUSE_YOU_WATCHED_ROWS);

  const rows = await Promise.all(
    recent.map(async (w) => {
      const items =
        w.media_type === "anime"
          ? await fetchBecauseYouWatchedAnimeSafe(w.id, isKids)
          : await fetchBecauseYouWatchedSafe(w.id, w.media_type, isKids);
      return { title: `Because you watched ${w.title}`, items, reason: "because-you-watched" as const };
    })
  );

  // A title with a thin or fully-filtered recommendations pool (common for
  // niche titles, or kids profiles where most recs get cert-blocked) just
  // doesn't get a row, rather than shipping an awkward 2-item shelf.
  return rows.filter((r) => r.items.length >= 6);
}

// Builds the candidate pool for the personalized row: everything gathered
// for trending/popular/because-you-watched, deduped, minus anything the
// person has already watched. Reusing those fetches (rather than issuing
// yet more API calls) keeps this cheap.
function gatherCandidatePool(rows: HomeFeedRow[], watchHistory: WatchHistoryEntry[]): TmdbItem[] {
  const watchedIds = new Set(watchHistory.map(watchedKey));
  const seen = new Set<string>();
  const pool: TmdbItem[] = [];
  for (const row of rows) {
    for (const item of row.items) {
      const key = watchedKey(item);
      if (watchedIds.has(key) || seen.has(key)) continue;
      seen.add(key);
      pool.push(item);
    }
  }
  return pool;
}

function buildForYouRow(pool: TmdbItem[], todayTasteTarget: StoryDNA, mood: ReturnType<typeof deriveSessionMood>): HomeFeedRow {
  const scored = pool.map((item) => {
    const dna = inferStoryDNA(toStoryDNAInput(item));
    const score = hybridScore({
      candidateDNA: dna,
      todayTasteTarget,
      isInCollaborativePool: !!item.fromRecommendations,
      popularityScore: normalizePopularity(item.popularity),
      sessionMood: mood,
      alreadyWatched: false,
    });
    return { item, score, dna };
  });
  scored.sort((a, b) => b.score - a.score);
  const diversified = diversifyByDominantTrait(scored, 3).slice(0, ROW_SIZE);
  return { title: "For You", items: diversified, reason: "for-you" };
}

export async function buildHomeFeed(opts: {
  profileId: string;
  watchHistory: WatchHistoryEntry[];
  isKids: boolean;
}): Promise<HomeFeedRow[]> {
  const { profileId, watchHistory, isKids } = opts;

  // Trending is unconditional — matches Netflix's own behavior of always
  // surfacing what's hot regardless of how much history a profile has.
  const trendingRow = await buildTrendingRow(isKids);

  if (watchHistory.length < COLD_START_THRESHOLD) {
    const popularRows = await buildPopularRows(isKids);
    return [trendingRow, ...popularRows];
  }

  const [becauseRows, popularRows] = await Promise.all([
    buildBecauseYouWatchedRows(watchHistory, isKids),
    buildPopularRows(isKids),
  ]);

  const permanent =
    loadPermanentTaste(profileId)?.permanent ??
    averageDNA(watchHistory.map((w) => ({ dna: inferStoryDNA(w) })));
  const mood = deriveSessionMood();
  const todayTasteTarget = blendTasteForToday(permanent, mood);

  const candidatePool = gatherCandidatePool([trendingRow, ...popularRows, ...becauseRows], watchHistory);
  const forYouRow = buildForYouRow(candidatePool, todayTasteTarget, mood);

  // For You leads (it's the most personalized), then because-you-watched
  // rows (direct, explainable signal), then trending/popular as the
  // dependable back half of the page — same shape Netflix uses.
  return [forYouRow, ...becauseRows, trendingRow, ...popularRows];
}
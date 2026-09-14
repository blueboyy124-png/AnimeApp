"use client";

import { useState, useEffect, useRef, useMemo, useCallback, ChangeEvent } from "react";
import ProfileGate, { useProfile } from "./profilegate";
import TopBar from "./components/TopBar";
import { getApiBaseUrl } from "./utils/api";
import { supabase } from "./utils/supabase";
import { filterForKids, useKidsSafeList, filterMatureRatings } from "./utils/contentFilter";
import {
  inferStoryDNA,
  cosineSimilarity,
  averageDNA,
  loadPermanentTaste,
  updatePermanentTaste,
  deriveSessionMood,
  blendTasteForToday,
  recordImpression,
  getImpressionMap,
  hybridScore,
  diversifyByDominantTrait,
  NEUTRAL_DNA,
  type StoryDNA,
  type SessionMood,
} from "./utils/recommendationEngine";
import { AnimeCard, WatchHistoryItem, FeedCategory, SeededRecommendationRow } from "./components/home/types";
import { isTmdbResult, ShowcaseSkeleton } from "./components/home/cardHelpers";
import { HeroSlider } from "./components/home/HeroSlider";
import { WatchHistory } from "./components/home/WatchHistory";
import { RecommendationRow } from "./components/home/RecommendationRow";
import { FeedGrid } from "./components/home/FeedGrid";
import { SearchResults } from "./components/home/SearchResults";

// ══════════════════════════════════════════════════════════════
// FEED CACHE
// Backs the tab bar (Recommendations/Trending/Upcoming/Popular) with a
// stale-while-revalidate pattern: switching tabs shows whatever we already
// have instantly (no loading state, no flicker), then silently refetches in
// the background and only swaps content in if it actually changed. Persisted
// to sessionStorage so even a fresh page load starts from last-known data
// instead of a blank/loading state.
// ══════════════════════════════════════════════════════════════
const FEED_CACHE_KEY = "streamanime_feed_cache_v1";

interface FeedCacheEntry {
  results: AnimeCard[];
  headline?: string;
}

function loadFeedCache(): Record<string, FeedCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(FEED_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveFeedCache(cache: Record<string, FeedCacheEntry>) {
  try {
    sessionStorage.setItem(FEED_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // sessionStorage full/unavailable (e.g. private browsing) — non-fatal,
    // the in-memory cache for this tab session still works fine.
  }
}

function sameResultIds(a: AnimeCard[], b: AnimeCard[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

// Every endpoint on this backend wraps its payload a little differently
// ({results: {results: [...]}} vs {results: [...]} vs a bare array) — this
// normalizes any of those shapes into a plain array.
function extractResultsArray(data: any): AnimeCard[] {
  if (data && data.results && Array.isArray(data.results.results)) return data.results.results;
  if (data && Array.isArray(data.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

// ══════════════════════════════════════════════════════════════
// MANUALLY EXCLUDED SHOWS
// A small, explicit blocklist for titles that shouldn't surface anywhere in
// the app — hero spotlight, "because you watched", adaptive rows, the
// standard browse grid, or search — regardless of what the recommendation
// engine or trending feed says about them. Match by id (most reliable) or,
// if the id isn't known, by exact title. Filtering happens at the few
// choke points every list passes through before it's rendered (see
// excludeBlockedShows below), so adding an entry here is enough — no need
// to touch each individual fetch call site.
const EXCLUDED_SHOW_IDS: Set<string> = new Set([
  // "12345",           // <- put the AniList/TMDB id here
]);
const EXCLUDED_SHOW_TITLES: Set<string> = new Set([
  "tagesschau",
]);

function getComparableTitle(item: AnimeCard): string {
  if (typeof item.title === "string") return item.title;
  if (item.title && typeof item.title === "object") {
    return item.title.english || item.title.romaji || item.title.userPreferred || "";
  }
  return item.name || "";
}

function isExcludedShow(item: AnimeCard): boolean {
  if (EXCLUDED_SHOW_IDS.has(String(item.id))) return true;
  if (EXCLUDED_SHOW_TITLES.size === 0) return false;
  return EXCLUDED_SHOW_TITLES.has(getComparableTitle(item).trim().toLowerCase());
}

function excludeBlockedShows(list: AnimeCard[]): AnimeCard[] {
  if (EXCLUDED_SHOW_IDS.size === 0 && EXCLUDED_SHOW_TITLES.size === 0) return list;
  return list.filter((item) => !isExcludedShow(item));
}

// Round-robins multiple lists together (list1[0], list2[0], list3[0],
// list1[1], list2[1], ...) instead of concatenating them as clumped blocks —
// used to blend anime/TV/movie recommendations into one mixed feed.
function interleaveLists<T>(...lists: T[][]): T[] {
  const result: T[] = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (list[i] !== undefined) result.push(list[i]);
    }
  }
  return result;
}

// TMDB's /search/multi returns movies, TV shows, and people all mixed
// together with media_type telling them apart, and uses genuinely correct
// TMDB ids (unlike JustWatch's own internal ids) — poster_path is already
// TMDB's own relative path format, so getDisplayCover() handles it as-is.
// TMDB movie/TV genre ids -> lowercase names. TMDB's TV genre ids diverge
// slightly from its movie ids (10759 "Action & Adventure" vs 28 "Action",
// etc.) so both sets are mapped onto the same trait-vocabulary strings the
// recommendation engine already understands.
const TMDB_GENRE_MAP: Record<number, string> = {
  28: "action",
  12: "adventure",
  16: "animation",
  35: "comedy",
  80: "crime",
  99: "documentary",
  18: "drama",
  10751: "family",
  14: "fantasy",
  36: "history",
  27: "horror",
  10402: "music",
  9648: "mystery",
  10749: "romance",
  878: "science fiction",
  10770: "drama",
  53: "thriller",
  10752: "war",
  37: "western",
  10759: "action",
  10762: "family",
  10763: "documentary",
  10764: "documentary",
  10765: "fantasy",
  10766: "romance",
  10767: "comedy",
  10768: "war",
};

// ══════════════════════════════════════════════════════════════
// ANIME TITLE MAPPING
// Maps known anime titles to their live-action adaptations / related
// media. When a TMDB movie/TV result matches one of these titles, the
// card tag is changed from "Movie"/"TV Show" to "Live-Action" so users
// can tell at a glance it's related to the anime they know. Keys are
// normalized (lowercase, stripped).
// ══════════════════════════════════════════════════════════════
const ANIME_ADAPTATION_TITLES: Record<string, string> = {
  "death note": "Live-Action",
  "cowboy bebop": "Live-Action",
  "one piece": "Live-Action",
  "attack on titan": "Live-Action",
  "fullmetal alchemist": "Live-Action",
  "bleach": "Live-Action",
  "dragon ball": "Live-Action",
  "naruto": "Live-Action",
  "pokemon": "Live-Action",
  "detective conan": "Live-Action",
  "rurouni kenshin": "Live-Action",
  "gintama": "Live-Action",
  "tokyo ghoul": "Live-Action",
  "parasyte": "Live-Action",
  "jojo's bizarre adventure": "Live-Action",
  "ghost in the shell": "Live-Action",
  "alita": "Live-Action",
  "speed racer": "Live-Action",
  "akira": "Live-Action",
  "sailor moon": "Live-Action",
  "yu yu hakusho": "Live-Action",
  "yu-gi-oh": "Live-Action",
  "beyblade": "Live-Action",
  "inuyasha": "Live-Action",
  "slam dunk": "Live-Action",
  "initial d": "Live-Action",
  "great teacher onizuka": "Live-Action",
  "gto": "Live-Action",
  "kakegurui": "Live-Action",
  "promised neverland": "Live-Action",
  "the promised neverland": "Live-Action",
  "my hero academia": "Live-Action",
  "jujutsu kaisen": "Live-Action",
  "chainsaw man": "Live-Action",
  "demon slayer": "Live-Action",
  "kimetsu no yaiba": "Live-Action",
  "spy x family": "Live-Action",
  "frieren": "Live-Action",
  "solo leveling": "Live-Action",
  "vinland saga": "Live-Action",
  "berserk": "Live-Action",
  "hunter x hunter": "Live-Action",
  "sword art online": "Live-Action",
  "code geass": "Live-Action",
  "evangelion": "Live-Action",
  "neon genesis evangelion": "Live-Action",
  "steins gate": "Live-Action",
  "re zero": "Live-Action",
  "konosuba": "Live-Action",
  "overlord": "Live-Action",
  "that time i got reincarnated as a slime": "Live-Action",
  "mushoku tensei": "Live-Action",
  "made in abyss": "Live-Action",
  "violet evergarden": "Live-Action",
  "your name": "Live-Action",
  "tokyo revengers": "Live-Action",
  "one punch man": "Live-Action",
  "mob psycho": "Live-Action",
  "fate stay night": "Live-Action",
  "black clover": "Live-Action",
  "fire force": "Live-Action",
  "dr stone": "Live-Action",
  "haikyuu": "Live-Action",
  "kuroko no basket": "Live-Action",
  "food wars": "Live-Action",
  "assassination classroom": "Live-Action",
  "danganronpa": "Live-Action",
  "persona": "Live-Action",
  "yakuza": "Live-Action",
  "like a dragon": "Live-Action",
  "street fighter": "Live-Action",
  "mortal kombat": "Live-Action",
  "tekken": "Live-Action",
  "sonic": "Live-Action",
  "super mario": "Live-Action",
  "zelda": "Live-Action",
  "detective pikachu": "Live-Action",
  "samurai champloo": "Live-Action",
  "trigun": "Live-Action",
  "hellsing": "Live-Action",
  "gurren lagann": "Live-Action",
  "kill la kill": "Live-Action",
  "little witch academia": "Live-Action",
  "devilman": "Live-Action",
  "cyberpunk": "Live-Action",
  "edgerunners": "Live-Action",
  "dorohedoro": "Live-Action",
  "blue lock": "Live-Action",
  "captain tsubasa": "Live-Action",
  "prince of tennis": "Live-Action",
  "hajime no ippo": "Live-Action",
  "baki": "Live-Action",
  "kengan ashura": "Live-Action",
  "record of ragnarok": "Live-Action",
  "goblin slayer": "Live-Action",
  "reincarnated as a slime": "Live-Action",
  "jobless reincarnation": "Live-Action",
  "rising of the shield hero": "Live-Action",
  "shield hero": "Live-Action",
  "arifureta": "Live-Action",
  "cautious hero": "Live-Action",
  "no game no life": "Live-Action",
  "log horizon": "Live-Action",
};

// Returns the adaptation tag for a TMDB title, or null if it's not a known
// anime adaptation. Uses normalized title matching.
function getAnimeAdaptationTag(item: AnimeCard): string | null {
  const title = normalizeTitleForMatch(getSearchTitle(item));
  if (!title) return null;
  // Exact match first
  if (ANIME_ADAPTATION_TITLES[title]) return ANIME_ADAPTATION_TITLES[title];
  // Then check if the title contains a known anime title (e.g. "One Piece: The Movie")
  for (const [key, tag] of Object.entries(ANIME_ADAPTATION_TITLES)) {
    if (title.includes(key)) return tag;
  }
  return null;
}

function mapTmdbGenreIds(ids?: number[]): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => TMDB_GENRE_MAP[id]).filter((g): g is string => !!g);
}

function extractTmdbResults(data: any): AnimeCard[] {
  const raw = Array.isArray(data?.results) ? data.results : [];
  return raw
    .filter((r: any) => r?.media_type === "movie" || r?.media_type === "tv")
    .map((r: any) => ({
      id: r.id,
      title: r.title || r.name,
      media_type: r.media_type,
      poster_path: r.poster_path,
      overview: r.overview,
      backdrop_path: r.backdrop_path,
      genres: mapTmdbGenreIds(r.genre_ids),
      // Preserved raw so isAnimationTmdbResult() (cardHelpers.tsx) has the
      // original TMDB genre ids to check against, even though `genres`
      // above already carries the mapped "animation" string for genre 16 —
      // this keeps the two checks independent instead of one silently
      // depending on the other's mapping staying in sync.
      genre_ids: r.genre_ids,
      averageScore: typeof r.vote_average === "number" && r.vote_average > 0 ? r.vote_average * 10 : undefined,
      seasonYear: (r.release_date || r.first_air_date || "").slice(0, 4) || undefined,
    } as AnimeCard));
}

// Unlike /search/multi, TMDB's /movie/{id}/recommendations and
// /tv/{id}/recommendations responses don't include media_type per item
// (it's implied by which endpoint you called) — this tags it back on.
function extractTmdbRecommendations(data: any, mediaType: "movie" | "tv"): AnimeCard[] {
  const raw = Array.isArray(data?.results) ? data.results : [];
  return raw.map(
    (r: any) =>
      ({
        id: r.id,
        title: r.title || r.name,
        media_type: mediaType,
        poster_path: r.poster_path,
        overview: r.overview,
        backdrop_path: r.backdrop_path,
        genres: mapTmdbGenreIds(r.genre_ids),
        averageScore: typeof r.vote_average === "number" && r.vote_average > 0 ? r.vote_average * 10 : undefined,
        seasonYear: (r.release_date || r.first_air_date || "").slice(0, 4) || undefined,
      } as AnimeCard)
  );
}

const MIN_QUALITY_VOTE_AVERAGE = 6.5;
const MIN_QUALITY_VOTE_COUNT = 50;

// Same shape as extractTmdbRecommendations, but only keeps results clearing
// a "highly rated" bar — a minimum average AND a minimum vote count, so a
// single enthusiastic vote on an obscure title can't sneak in. Used for the
// general browse tabs, which should feel curated rather than just "whatever
// TMDB returns in API order".
function extractHighlyRatedTmdb(data: any, mediaType: "movie" | "tv"): AnimeCard[] {
  const raw = Array.isArray(data?.results) ? data.results : [];
  return raw
    .filter((r: any) => (r.vote_average || 0) >= MIN_QUALITY_VOTE_AVERAGE && (r.vote_count || 0) >= MIN_QUALITY_VOTE_COUNT)
    .map(
      (r: any) =>
        ({
          id: r.id,
          title: r.title || r.name,
          media_type: mediaType,
          poster_path: r.poster_path,
          overview: r.overview,
          backdrop_path: r.backdrop_path,
          genres: mapTmdbGenreIds(r.genre_ids),
          averageScore: r.vote_average * 10,
          seasonYear: (r.release_date || r.first_air_date || "").slice(0, 4) || undefined,
        } as AnimeCard)
    );
}

// Fetches one page of movies+TV from TMDB for a browse category, interleaved.
// Trending/Popular apply the "highly rated" bar above; Upcoming doesn't —
// new releases genuinely have few or no votes yet, so rating-filtering them
// the same way would leave the tab nearly empty.
async function fetchTmdbCategoryPage(
  apiKey: string,
  kind: "trending" | "popular" | "upcoming",
  page: number
): Promise<AnimeCard[]> {
  try {
    if (kind === "trending") {
      const res = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${apiKey}&page=${page}`);
      const data = await res.json();
      const raw = Array.isArray(data?.results) ? data.results : [];
      return raw
        .filter(
          (r: any) =>
            (r.media_type === "movie" || r.media_type === "tv") &&
            (r.vote_average || 0) >= MIN_QUALITY_VOTE_AVERAGE &&
            (r.vote_count || 0) >= MIN_QUALITY_VOTE_COUNT
        )
        .map(
          (r: any) =>
            ({
              id: r.id,
              title: r.title || r.name,
              media_type: r.media_type,
              poster_path: r.poster_path,
              overview: r.overview,
              backdrop_path: r.backdrop_path,
              genres: mapTmdbGenreIds(r.genre_ids),
              averageScore: r.vote_average * 10,
              seasonYear: (r.release_date || r.first_air_date || "").slice(0, 4) || undefined,
            } as AnimeCard)
        );
    }

    if (kind === "popular") {
      const [movieRes, tvRes] = await Promise.all([
        fetch(`https://api.themoviedb.org/3/movie/popular?api_key=${apiKey}&page=${page}`).then((r) => r.json()),
        fetch(`https://api.themoviedb.org/3/tv/popular?api_key=${apiKey}&page=${page}`).then((r) => r.json()),
      ]);
      return interleaveLists(extractHighlyRatedTmdb(movieRes, "movie"), extractHighlyRatedTmdb(tvRes, "tv"));
    }

    // upcoming — no rating filter (see comment above)
    const [movieRes, tvRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/upcoming?api_key=${apiKey}&page=${page}`).then((r) => r.json()),
      fetch(`https://api.themoviedb.org/3/tv/on_the_air?api_key=${apiKey}&page=${page}`).then((r) => r.json()),
    ]);
    return interleaveLists(extractTmdbRecommendations(movieRes, "movie"), extractTmdbRecommendations(tvRes, "tv"));
  } catch {
    return [];
  }
}

// Fetches multiple pages of a TMDB category in parallel and merges them —
// this is what gives the feed real depth (Netflix-scale) instead of a
// single 20-item page.
async function fetchTmdbCategoryPages(
  apiKey: string,
  kind: "trending" | "popular" | "upcoming",
  pages: number
): Promise<AnimeCard[]> {
  const settled = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) => fetchTmdbCategoryPage(apiKey, kind, i + 1))
  );
  const merged = settled
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);
  return Array.from(new Map(merged.map((item) => [`${item.media_type}-${item.id}`, item])).values());
}

// Strips punctuation/spacing/case so "Attack on Titan" and "Attack on
// Titan: Final Season" comparisons aren't thrown off by trivial formatting
// differences when checking whether a TV/movie result is really the same
// show as an anime result.
function normalizeTitleForMatch(str: string): string {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ══════════════════════════════════════════════════════════════
// ALIAS / ABBREVIATION DICTIONARY
// Static lookup, no AI, no network call. Resolves common shorthand to the
// real title BEFORE it ever reaches the Pi backend or TMDB — this both
// improves hit rate and avoids sending queries that would just miss and
// need a manual retype. Keep this list small and hand-curated; it's meant
// to catch the handful of abbreviations people actually type, not to be a
// full fuzzy index (that job belongs to a real search-index.json later).
// ══════════════════════════════════════════════════════════════
const SEARCH_ALIAS_MAP: Record<string, string> = {
  jjk: "jujutsu kaisen",
  aot: "attack on titan",
  snk: "attack on titan",
  op: "one piece",
  mha: "my hero academia",
  bnha: "my hero academia",
  ds: "demon slayer",
  kny: "demon slayer",
  hxh: "hunter x hunter",
  fmab: "fullmetal alchemist brotherhood",
  csm: "chainsaw man",
  jjba: "jojo's bizarre adventure",
  swk: "solo leveling",
  mcu: "marvel",
};

// A short list of common misspellings worth catching outright, separate
// from the abbreviation map above — these are typo corrections, not
// shorthand expansions.
const SEARCH_TYPO_MAP: Record<string, string> = {
  marval: "marvel",
  "jujutsu kisen": "jujutsu kaisen",
  "atack on titan": "attack on titan",
  "wan piece": "one piece",
};

// Applied once, right before a query leaves the client. Cheap object lookup
// — no Levenshtein, no scanning — so it costs nothing on every keystroke.
function resolveSearchAlias(query: string): string {
  const key = normalizeTitleForMatch(query);
  if (SEARCH_TYPO_MAP[key]) return SEARCH_TYPO_MAP[key];
  if (SEARCH_ALIAS_MAP[key]) return SEARCH_ALIAS_MAP[key];
  return query;
}

function getSearchTitle(item: AnimeCard): string {
  if (typeof item.title === "string") return item.title;
  if (item.title && typeof item.title === "object") {
    return (item.title as any).english || (item.title as any).romaji || (item.title as any).userPreferred || "";
  }
  return item.name || "";
}

// Anime results always win. If a TV/movie result's title matches an anime
// result we already have (e.g. a show that's technically catalogued as a
// TMDB "TV series" but is really an anime), drop the TV/movie duplicate
// entirely rather than showing the same show twice with two different
// (and differently-functional) playback routes.
function mergeSearchResults(animeResults: AnimeCard[], tvMovieResults: AnimeCard[]): AnimeCard[] {
  const animeTitles = new Set(animeResults.map((a) => normalizeTitleForMatch(getSearchTitle(a))));
  const dedupedTvMovie = tvMovieResults.filter(
    (item) => !animeTitles.has(normalizeTitleForMatch(getSearchTitle(item)))
  );
  return [...animeResults, ...dedupedTvMovie];
}

// Ranks exact title matches first, then "starts with", then "contains
// somewhere" — falling back to whatever order the source API returned for
// anything else. Keeps a fuzzy backend match from burying the title someone
// actually typed near the bottom of its category.
function sortByRelevance(list: AnimeCard[], query: string): AnimeCard[] {
  const q = normalizeTitleForMatch(query);
  if (!q) return list;

  const rank = (item: AnimeCard) => {
    const title = normalizeTitleForMatch(getSearchTitle(item));
    if (title === q) return 0;
    if (title.startsWith(q)) return 1;
    if (title.includes(q)) return 2;
    return 3;
  };

  return [...list]
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

function HomePageContent() {
  const { profile: currentProfile, switchProfile, logout, needsPasswordSetup, openSetPassword } = useProfile();

  const [trending, setTrending] = useState<AnimeCard[]>([]);
  const [currentFeed, setCurrentFeed] = useState<AnimeCard[]>([]);
  const [activeCategory, setActiveCategory] = useState<FeedCategory>("recommendations");
  
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<AnimeCard[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchingLoading, setSearchingLoading] = useState<boolean>(false);
  
  const [searchPage, setSearchPage] = useState<number>(1);
  const [hasMoreResults, setHasMoreResults] = useState<boolean>(true);
  const [activeHeroIndex, setActiveHeroIndex] = useState<number>(0);
  const [heroPaused, setHeroPaused] = useState<boolean>(false);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [recommendationHeadline, setRecommendationHeadline] = useState<string>("Picks For You");

  // ── Recommendation engine state ──────────────────────────────────────
  // permanentTasteDNA drifts slowly (EMA) as watch history accumulates; the
  // session mood is derived once per visit from local time-of-day/weekday.
  // Together they blend into "today's" target vector used for scoring.
  const [permanentTasteDNA, setPermanentTasteDNA] = useState<StoryDNA | null>(null);
  const [sessionMood, setSessionMood] = useState<SessionMood | null>(null);
  const hoverStartRef = useRef<Record<string, number>>({});

  const feedCacheRef = useRef<Record<string, FeedCacheEntry>>({});
  const feedRequestIdRef = useRef(0);
  const feedCacheHydratedRef = useRef(false);
  const searchCacheRef = useRef<Record<string, AnimeCard[]>>({});
  const searchLastFetchedRef = useRef<Record<string, number>>({});
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);

  const API_BASE = getApiBaseUrl();
  const TMDB_API_KEY = "e0554f6521da4365d4a36ea7ff17ae51";
  const RESULTS_PER_PAGE = 20;

  useEffect(() => {
    const cache = loadFeedCache();
    const cachedHero = cache["_hero"];
    if (cachedHero) {
      // Instant paint from whatever we last saw — this is what kills the
      // black-flash-then-pop-in on every homepage visit.
      setTrending(excludeBlockedShows(cachedHero.results));
    }

    fetchTmdbCategoryPage(TMDB_API_KEY, "popular", 1)
      .then((results) => {
        if (!cachedHero || !sameResultIds(cachedHero.results, results)) {
          setTrending(excludeBlockedShows(results));
        }

        // Cache the raw (unfiltered) results so the blocklist can change
        // later without needing to bust the session cache.
        cache["_hero"] = { results };
        saveFeedCache(cache);
      })
      .catch((err) => console.error("Error fetching trending spotlight banner:", err));
  }, [API_BASE]);

  // Hydrate the feed cache from sessionStorage once on mount.
  useEffect(() => {
    feedCacheRef.current = loadFeedCache();
    feedCacheHydratedRef.current = true;
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (activeCategory === "recommendations" && !currentProfile) return;

    const cacheKey = activeCategory === "recommendations"
      ? `recommendations:${currentProfile?.id}`
      : activeCategory;

    const cached = feedCacheRef.current[cacheKey];
    const requestId = ++feedRequestIdRef.current;

    if (cached) {
      // Instant repaint from what we already have — no loading state, so
      // switching tabs back and forth never shows a spinner for data
      // we've already fetched this session.
      setCurrentFeed(cached.results);
      if (cached.headline) setRecommendationHeadline(cached.headline);
      setLoading(false);
    } else if (activeCategory === "recommendations" && trending.length > 0) {
      // Cold start, nothing cached yet — trending (already loaded for the
      // hero anyway) makes a reasonable instant placeholder while the real
      // multi-page pool below loads in.
      setCurrentFeed(trending);
      setLoading(false);
    } else {
      setLoading(true);
    }

    // Trending/Popular/Upcoming and Recommendations are all TMDB-driven now
    // — this is a movies/TV site that also has anime, not the other way
    // around. Anime only ever appears in Recommendations, and only once
    // animeRecs has something to show (which itself only happens once the
    // person has actual anime watch history) — see picksForYouFeed below.
    async function loadTmdbCategory() {
      let results: AnimeCard[] = [];

      if (activeCategory === "recommendations") {
        // NETFLIX-SCALE: fetch 5 pages of popular (100+ items) instead of
        // just 2, then rank by rating. Personalized picks (movieRecs/
        // tvRecs/animeRecs) get interleaved on top in picksForYouFeed.
        results = await fetchTmdbCategoryPages(TMDB_API_KEY, "popular", 5);
        results = results.sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0));
      } else {
        // Other tabs also get 3 pages for a deeper feed.
        results = await fetchTmdbCategoryPages(TMDB_API_KEY, activeCategory as "trending" | "popular" | "upcoming", 3);
      }

      // A newer tab switch or profile change already superseded this
      // request — drop the result instead of clobbering fresher state.
      if (requestId !== feedRequestIdRef.current) return;

      if (!cached || !sameResultIds(cached.results, results)) {
        setCurrentFeed(results);
      }

      feedCacheRef.current[cacheKey] = { results };
      saveFeedCache(feedCacheRef.current);
      setLoading(false);
    }

    loadTmdbCategory().catch((err) => {
      console.error(`Error loading category: ${activeCategory}`, err);
      if (!cached) {
        setCurrentFeed([]);
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, API_BASE, TMDB_API_KEY, currentProfile]);

  // Watch history is shared across every device on the account — it's written to
  // `profiles.recent_episodes` in Supabase by the player (see watch/page.tsx).
  // localStorage is kept only as an offline-friendly cache; it is never the
  // source of truth, since a purely local cache is exactly what let one device
  // go stale while another device kept watching.
  //
  // Dedup key is anilistId ALONE — one card per show, period. The list is
  // already sorted newest-first by updatedAt, so keeping the first occurrence
  // per anilistId means that card always reflects the latest episode watched,
  // no matter which device logged it.
  function dedupeWatchHistory(list: WatchHistoryItem[]): WatchHistoryItem[] {
    const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    const seen = new Set<string>();
    const unique: WatchHistoryItem[] = [];
    for (const item of sorted) {
      const key = String(item.anilistId);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }

  useEffect(() => {
    if (!currentProfile) return;
    let cancelled = false;

    async function loadWatchHistory() {
      const storageKey = `streamanime_watch_history_${currentProfile!.id}`;

      // Show the local cache immediately (instant, no flash of empty state)
      // while the authoritative cloud copy loads in behind it.
      try {
        const cachedRaw = localStorage.getItem(storageKey);
        if (cachedRaw) setWatchHistory(dedupeWatchHistory(JSON.parse(cachedRaw)));
      } catch {
        // corrupt/unavailable cache — fine, cloud fetch below will fix it
      }

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("recent_episodes")
          .eq("id", currentProfile!.id)
          .single();

        if (cancelled) return;
        if (error) throw error;

        const cloudHistory: WatchHistoryItem[] = Array.isArray(data?.recent_episodes) ? data.recent_episodes : [];
        const unique = dedupeWatchHistory(cloudHistory);

        setWatchHistory(unique);
        localStorage.setItem(storageKey, JSON.stringify(unique));
      } catch (e) {
        console.error("Failed to load cloud watch history, falling back to local cache:", e);
        // Local cache (already set above, if present) stands as the fallback.
      }
    }

    loadWatchHistory();

    // A second device may have watched something new while this tab sat in the
    // background — refresh from the cloud when the user comes back to it.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") loadWatchHistory();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", loadWatchHistory);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", loadWatchHistory);
    };
  }, [currentProfile]);

  // Load whatever permanent taste profile we already have as soon as we know
  // who's browsing, so scoring has a real target vector even before this
  // session's watch history/recommendation pools have loaded in.
  useEffect(() => {
    if (!currentProfile) {
      setPermanentTasteDNA(null);
      return;
    }
    const stored = loadPermanentTaste(currentProfile.id);
    if (stored) setPermanentTasteDNA(stored.permanent);
  }, [currentProfile]);

  // Session mood only depends on local time-of-day/weekday, so it's derived
  // once per visit rather than re-derived on every render.
  useEffect(() => {
    setSessionMood(deriveSessionMood());
  }, []);


  useEffect(() => {
    if (trending.length === 0) return;
    const limit = Math.min(trending.length, 5);
    const interval = setInterval(() => {
      setActiveHeroIndex((prevIndex) => (prevIndex + 1) % limit);
    }, 4000);

    return () => clearInterval(interval);
  }, [trending]);

  const performSearchFetch = async (rawQuery: string, targetPage: number, appendMode: boolean) => {
    if (!rawQuery.trim()) return;

    // Resolve abbreviations/typos (e.g. "jjk" -> "jujutsu kaisen") before
    // this ever leaves the browser — a static lookup, not a network call.
    const query = resolveSearchAlias(rawQuery);

    const requestId = ++searchRequestIdRef.current;
    const cacheKey = `${query.trim().toLowerCase()}:${targetPage}`;

    // A fast typist can fire several searches per second. Without this, each
    // earlier keystroke's request still runs to completion on the Pi even
    // though only the newest response gets used — pure wasted backend work.
    // Cancelling the previous in-flight request means the Pi only ever does
    // the work for the query the user actually settled on.
    searchAbortControllerRef.current?.abort();
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;

    // Don't re-hit the backend for a query we already fetched in the last
    // minute — the cached result is shown instantly either way, so a
    // near-immediate re-fetch just burns Pi cycles for an answer we already
    // have. Explicit "Load More" (appendMode) always goes through.
    const lastFetchedAt = searchLastFetchedRef.current[cacheKey];
    if (!appendMode && lastFetchedAt && Date.now() - lastFetchedAt < 60_000) {
      return;
    }

    // Don't show a loading spinner if we already painted cached results for
    // this exact query synchronously in handleSearchChange — only the very
    // first time a term is searched needs a visible loading state.
    if (!appendMode && !searchCacheRef.current[cacheKey]) setSearchingLoading(true);

    try {
      // Anime has its own API and intentionally remains first in the merged
      // list. Movie/TV search now goes straight to TMDB's own search/multi
      // endpoint (not JustWatch) — JustWatch's ids ("tm157099", "ts57131")
      // are its own internal ids, not guaranteed to match the real TMDB id,
      // which was sending clicks to the wrong title. TMDB's native search
      // returns real TMDB ids directly, and unlike JustWatch it's actually
      // paginated, so "load more" works properly for this half too.
      const animeUrl = `${API_BASE}/search?query=${encodeURIComponent(query)}&page=${targetPage}&per_page=${RESULTS_PER_PAGE}`;
      const tmdbUrl = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=${targetPage}&language=en-US`;

      const [animeRes, tvMovieRes] = await Promise.allSettled([
        fetch(animeUrl, { signal: controller.signal }).then((r) => r.json()),
        fetch(tmdbUrl, { signal: controller.signal }).then((r) => r.json()),
      ]);

      // A newer keystroke already fired a fresher search — drop this
      // response instead of letting a slow, stale request win the race.
      if (requestId !== searchRequestIdRef.current) return;

      const animeResults = animeRes.status === "fulfilled" ? extractResultsArray(animeRes.value) : [];
      const tvMovieResults =
        tvMovieRes.status === "fulfilled" ? extractTmdbResults(tvMovieRes.value) : [];
      const parsedResults = mergeSearchResults(animeResults, tvMovieResults);

      if (appendMode) {
        setSearchResults((prev) => [...prev, ...parsedResults]);
      } else {
        setSearchResults(parsedResults);
        searchCacheRef.current[cacheKey] = parsedResults;
        searchLastFetchedRef.current[cacheKey] = Date.now();
      }

      const tmdbData = tvMovieRes.status === "fulfilled" ? tvMovieRes.value : null;
      const tmdbHasMore = !!tmdbData && Number(tmdbData.page) < Number(tmdbData.total_pages);
      setHasMoreResults(animeResults.length >= RESULTS_PER_PAGE || tmdbHasMore);
    } catch (err: any) {
      // Aborted requests are expected noise from the cancellation above,
      // not a real error — only log genuine failures.
      if (err?.name !== "AbortError") {
        console.error("Local search query exception track dropped:", err);
      }
      if (!appendMode && err?.name !== "AbortError") setSearchResults([]);
    } finally {
      if (requestId === searchRequestIdRef.current) setSearchingLoading(false);
    }
  };

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    setSearchPage(1);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length <= 2) {
      setSearchResults([]);
      return;
    }

    // Instant repaint if we've already searched this exact term this
    // session, then still quietly re-validate in the background after the
    // debounce — catches anything new without ever showing a blank/loading
    // flash for a query we already have an answer for.
    const resolvedForCache = resolveSearchAlias(trimmed);
    const cached = searchCacheRef.current[`${resolvedForCache.toLowerCase()}:1`];
    if (cached) setSearchResults(cached);

    // 300ms debounce — waits for a pause in typing instead of firing a
    // network request on every single keystroke.
    searchDebounceRef.current = setTimeout(() => {
      performSearchFetch(trimmed, 1, false);
    }, 300);
  };

  const handleLoadMoreSearch = () => {
    const nextPage = searchPage + 1;
    setSearchPage(nextPage);
    performSearchFetch(searchQuery, nextPage, true);
  };

  // ── Card impression tracking ──────────────────────────────────────────
  // Richer than click-only tracking: distinguishes "hovered, read the card,
  // then moved on" (dismissed) from "clicked immediately" from "never
  // really looked" (short hover). Feeds the novelty/fatigue term in
  // hybridScore on future visits. Threaded down into every card-rendering
  // component (FeedGrid, SearchResults, RecommendationRow) as props.
  const handleCardHoverStart = useCallback((impressionKey: string) => {
    hoverStartRef.current[impressionKey] = Date.now();
  }, []);
  const handleCardHoverEnd = useCallback((impressionKey: string) => {
    if (!currentProfile) return;
    const start = hoverStartRef.current[impressionKey];
    if (!start) return;
    delete hoverStartRef.current[impressionKey];
    recordImpression(currentProfile.id, impressionKey, Date.now() - start, false);
  }, [currentProfile]);
  const handleCardClick = useCallback((impressionKey: string) => {
    if (!currentProfile) return;
    const start = hoverStartRef.current[impressionKey];
    const duration = start ? Date.now() - start : 0;
    delete hoverStartRef.current[impressionKey];
    recordImpression(currentProfile.id, impressionKey, duration, true);
  }, [currentProfile]);

  const isSearching = searchQuery.trim().length > 2;
  const isKids = currentProfile?.is_kids || false;

  // Declared here (rather than down near the effect that populates them) so
  // they're available for blending into the Picks for You feed below.
  const [movieRecs, setMovieRecs] = useState<SeededRecommendationRow | null>(null);
  const [tvRecs, setTvRecs] = useState<SeededRecommendationRow | null>(null);
  const [animeRecs, setAnimeRecs] = useState<SeededRecommendationRow | null>(null);

  // Picks for You ("recommendations" tab) previously came from the anime
  // API alone, so it only ever showed anime. Now it's a TMDB-driven
  // highly-rated movie/TV pool by default, with personalized picks blended
  // in on top (round-robin, so it's an actual mix rather than clumped
  // blocks) whenever there's watch history to seed them from. animeRecs is
  // only ever non-null once the person has actually watched anime (see the
  // effect that populates it) — so anime only appears here once someone's
  // shown interest in it, never as a cold-start default.
  const isRecommendationsView = activeCategory === "recommendations" && !isSearching;
  // "Today's" blended target — permanent taste drifted toward whatever the
  // current session's mood calls for (see blendTasteForToday).
  const todayTasteTarget = useMemo(
    () => blendTasteForToday(permanentTasteDNA || NEUTRAL_DNA, sessionMood || deriveSessionMood()),
    [permanentTasteDNA, sessionMood]
  );
  const watchedIdSet = useMemo(
    () => new Set(watchHistory.map((h) => String(h.anilistId))),
    [watchHistory]
  );
  const impressionMapForFeed = useMemo(
    () => (currentProfile ? getImpressionMap(currentProfile.id) : {}),
    [currentProfile]
  );

  const picksForYouFeedRaw = useMemo(() => {
    if (!isRecommendationsView) return currentFeed;
    // TMDB recommendations and the browsable feed can both contain the same
    // title (e.g. the same TV show appearing in tvRecs AND currentFeed), which
    // caused React duplicate-key errors and doubled cards in the same row.
    // Dedupe on media_type+id, preferring the recs that beat the generic feed.
    const deduped = new Map<string, AnimeCard>();
    const add = (item: AnimeCard) => {
      const key = `${item.media_type || "anime"}-${item.id}`;
      if (!deduped.has(key)) deduped.set(key, item);
    };
    for (const item of interleaveLists(tvRecs?.items || [], movieRecs?.items || [], animeRecs?.items || [], currentFeed)) {
      add(item);
    }
    return Array.from(deduped.values());
  }, [isRecommendationsView, tvRecs, movieRecs, animeRecs, currentFeed]);

  // Re-rank against the blended taste target, then run the anti-fatigue
  // diversification pass so the top of the grid doesn't turn into five
  // near-identical titles in a row (Phase 3's clustering idea). This is the
  // single most expensive computation on the page (DNA inference + scoring
  // + sort over the whole pool), so it's memoized against only the inputs
  // that actually change its output — without this it silently re-ran on
  // every keystroke while typing in search, dropping/blending frames.
  const picksForYouFeed = useMemo(() => {
    if (!isRecommendationsView) return picksForYouFeedRaw;
    return diversifyByDominantTrait(
      picksForYouFeedRaw
        .map((item) => {
          const dna = inferStoryDNA(item);
          return {
            item,
            dna,
            score: hybridScore({
              candidateDNA: dna,
              todayTasteTarget,
              isInCollaborativePool: false,
              popularityScore: Math.min(1, (item.averageScore || 0) / 100),
              sessionMood: sessionMood || deriveSessionMood(),
              impression: impressionMapForFeed[`${item.media_type || "anime"}-${item.id}`],
              alreadyWatched: watchedIdSet.has(String(item.id)),
            }),
          };
        })
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
    );
  }, [isRecommendationsView, picksForYouFeedRaw, todayTasteTarget, sessionMood, impressionMapForFeed, watchedIdSet]);

  // Two-pass kids filtering: filterForKids() is the fast, free, synchronous
  // pass (genre/isAdult, catches anime immediately). useKidsSafeList() is
  // the second pass — checks real TMDB certifications for movies/TV and
  // holds back rendering until that check resolves, so nothing above a
  // kids profile's rating cutoff ever has a chance to flash on screen.
  // The input list is memoized so its reference stays stable when nothing
  // actually changed — without this, useKidsSafeList saw a brand-new array
  // every render and could re-kick its async cert lookups unnecessarily.
  const showcaseSourceList = useMemo(
    () => filterForKids(excludeBlockedShows(isSearching ? searchResults : picksForYouFeed), isKids),
    [isSearching, searchResults, picksForYouFeed, isKids]
  );
  const trendingSourceList = useMemo(
    () => filterForKids(excludeBlockedShows(trending), isKids),
    [trending, isKids]
  );
  const { list: standardShowcaseList, loading: showcaseRatingLoading } = useKidsSafeList(showcaseSourceList, isKids);
  const { list: kidsSafeTrending, loading: trendingRatingLoading } = useKidsSafeList(trendingSourceList, isKids);
  const topFiveTrending = useMemo(() => kidsSafeTrending.slice(0, 5), [kidsSafeTrending]);

  // ── Adaptive contextual micro-shelves (Phase 4) ──────────────────────
  // Generated from the same kids-safe, already-diversified showcase pool,
  // so nothing shown here bypasses the content filter that already ran.
  const moodForRows = sessionMood || deriveSessionMood();
  const unwatchedShowcase = useMemo(
    () => standardShowcaseList.filter((item) => !watchedIdSet.has(String(item.id))),
    [standardShowcaseList, watchedIdSet]
  );

  const underTheRadarRow = useMemo(() => {
    if (!isRecommendationsView) return [];
    return unwatchedShowcase
      .map((item) => ({
        item,
        popularity: Math.min(1, (item.averageScore || 0) / 100),
        similarity: cosineSimilarity(inferStoryDNA(item), todayTasteTarget),
      }))
      .filter((x) => x.popularity < 0.55 && x.similarity > 0.6)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20)
      .map((x) => x.item);
  }, [isRecommendationsView, unwatchedShowcase, todayTasteTarget]);

  const awardWinnersRow = useMemo(() => {
    if (!isRecommendationsView) return [];
    return unwatchedShowcase.filter((item) => (item.averageScore || 0) >= 78).slice(0, 20);
  }, [isRecommendationsView, unwatchedShowcase]);

  // Only surfaces when the mood it's built for actually applies — a
  // "Relax Before Bed" row at 2pm on a Tuesday would just be noise.
  const relaxBeforeBedRow = useMemo(() => {
    if (!isRecommendationsView || moodForRows.label !== "late-night") return [];
    return unwatchedShowcase
      .map((item) => ({ item, dna: inferStoryDNA(item) }))
      .sort((a, b) => b.dna.comfort - a.dna.comfort)
      .slice(0, 20)
      .map((x) => x.item);
  }, [isRecommendationsView, moodForRows.label, unwatchedShowcase]);

  const weekendBingeRow = useMemo(() => {
    if (!isRecommendationsView || moodForRows.label !== "weekend-binge") return [];
    return unwatchedShowcase
      .map((item) => ({ item, dna: inferStoryDNA(item) }))
      .sort((a, b) => b.dna.spectacle + b.dna.pacing - (a.dna.spectacle + a.dna.pacing))
      .slice(0, 20)
      .map((x) => x.item);
  }, [isRecommendationsView, moodForRows.label, unwatchedShowcase]);

  // Auto-advance the hero spotlight every 7s, same pattern as premium
  // streaming homepages — pauses naturally once there's nothing to rotate,
  // and now also pauses while the person is actually hovering the banner
  // so it doesn't yank the slide out from under them mid-read.
  useEffect(() => {
    if (topFiveTrending.length <= 1 || heroPaused) return;
    const id = setInterval(() => {
      setActiveHeroIndex((prev) => (prev + 1) % topFiveTrending.length);
    }, 7000);
    return () => clearInterval(id);
  }, [topFiveTrending.length, heroPaused]);

  const getHeaderTitle = () => {
    if (isSearching) return `Search Results: "${searchQuery}"`;
    if (activeCategory === "trending") return "Trending";
    if (activeCategory === "upcoming") return "Upcoming Releases";
    if (activeCategory === "recommendations") {
      // Taste Drift shows up here too — the same headline slot reflects
      // whatever mood the session-blended target vector picked up on.
      const mood = sessionMood || deriveSessionMood();
      if (mood.label === "late-night") return "Picks For a Chill Evening";
      if (mood.label === "weekend-binge") return "Picks For Your Weekend";
      return recommendationHeadline;
    }
    if (activeCategory === "popular") return "Popular Trends";
    return "Media Feed";
  };

  const animeSearchResults = useMemo(
    () => sortByRelevance(standardShowcaseList.filter((item) => !isTmdbResult(item)), searchQuery),
    [standardShowcaseList, searchQuery]
  );
  const movieSearchResults = useMemo(
    () => sortByRelevance(standardShowcaseList.filter((item) => item.media_type === "movie"), searchQuery),
    [standardShowcaseList, searchQuery]
  );
  const tvSearchResults = useMemo(
    () => sortByRelevance(standardShowcaseList.filter((item) => item.media_type === "tv"), searchQuery),
    [standardShowcaseList, searchQuery]
  );

  // --- "Because you watched X" recommendations ----------------------------
  // Netflix/Disney+-style separate rows per media type, each seeded by the
  // most recently watched item of that type. Movies/TV re-rank TMDB's own
  // recommendations endpoint with our hybrid score; anime has no such
  // endpoint available here, so it's approximated with StoryDNA cosine
  // similarity against the anime already on the page. Every row is filtered
  // for kids profiles before it's ever set into state, so nothing
  // unfiltered can flash on screen.
  useEffect(() => {
    if (watchHistory.length === 0) {
      setMovieRecs(null);
      setTvRecs(null);
      setAnimeRecs(null);
      return;
    }

    let cancelled = false;

    const mostRecentOf = (type: "movie" | "tv" | "anime") => {
      const matches = watchHistory.filter((h) =>
        type === "anime" ? !h.mediaType || h.mediaType === "anime" : h.mediaType === type
      );
      if (matches.length === 0) return null;
      return matches.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    };

    const moodForScoring = sessionMood || deriveSessionMood();
    const impressionMap = currentProfile ? getImpressionMap(currentProfile.id) : {};

    async function loadMovieRecs() {
      const seed = mostRecentOf("movie");
      if (!seed) {
        if (!cancelled) setMovieRecs(null);
        return;
      }
      try {
        const [recsRes, seedRes] = await Promise.all([
          fetch(`https://api.themoviedb.org/3/movie/${seed!.anilistId}/recommendations?api_key=${TMDB_API_KEY}&language=en-US`).then((r) => r.json()),
          fetch(`https://api.themoviedb.org/3/movie/${seed!.anilistId}?api_key=${TMDB_API_KEY}&language=en-US`).then((r) => r.json()).catch(() => null),
        ]);
        let items = extractTmdbRecommendations(recsRes, "movie");
        if (isKids) items = await filterMatureRatings(items, true);
        if (cancelled) return;

        // Re-rank TMDB's collaborative-filtering pool with our own hybrid
        // score instead of just taking API order — content similarity to
        // the seed, mood alignment, and novelty all get a say too.
        const seedDNA = inferStoryDNA({
          genres: Array.isArray(seedRes?.genres) ? seedRes.genres.map((g: any) => String(g.name).toLowerCase()) : [],
          overview: seedRes?.overview,
        });
        const ranked = items
          .map((item) => ({
            item,
            score: hybridScore({
              candidateDNA: inferStoryDNA(item),
              todayTasteTarget: seedDNA,
              isInCollaborativePool: true,
              popularityScore: Math.min(1, (item.averageScore || 0) / 100),
              sessionMood: moodForScoring,
              impression: impressionMap[`movie-${item.id}`],
              alreadyWatched: false,
            }),
          }))
          .sort((a, b) => b.score - a.score)
          .map((x) => x.item);

        setMovieRecs(ranked.length > 0 ? { seedTitle: seed!.animeTitle, items: ranked.slice(0, 20) } : null);
      } catch {
        if (!cancelled) setMovieRecs(null);
      }
    }

    async function loadTvRecs() {
      const seed = mostRecentOf("tv");
      if (!seed) {
        if (!cancelled) setTvRecs(null);
        return;
      }
      try {
        const [recsRes, seedRes] = await Promise.all([
          fetch(`https://api.themoviedb.org/3/tv/${seed!.anilistId}/recommendations?api_key=${TMDB_API_KEY}&language=en-US`).then((r) => r.json()),
          fetch(`https://api.themoviedb.org/3/tv/${seed!.anilistId}?api_key=${TMDB_API_KEY}&language=en-US`).then((r) => r.json()).catch(() => null),
        ]);
        let items = extractTmdbRecommendations(recsRes, "tv");
        if (isKids) items = await filterMatureRatings(items, true);
        if (cancelled) return;

        const seedDNA = inferStoryDNA({
          genres: Array.isArray(seedRes?.genres) ? seedRes.genres.map((g: any) => String(g.name).toLowerCase()) : [],
          overview: seedRes?.overview,
        });
        const ranked = items
          .map((item) => ({
            item,
            score: hybridScore({
              candidateDNA: inferStoryDNA(item),
              todayTasteTarget: seedDNA,
              isInCollaborativePool: true,
              popularityScore: Math.min(1, (item.averageScore || 0) / 100),
              sessionMood: moodForScoring,
              impression: impressionMap[`tv-${item.id}`],
              alreadyWatched: false,
            }),
          }))
          .sort((a, b) => b.score - a.score)
          .map((x) => x.item);

        setTvRecs(ranked.length > 0 ? { seedTitle: seed!.animeTitle, items: ranked.slice(0, 20) } : null);
      } catch {
        if (!cancelled) setTvRecs(null);
      }
    }

    async function loadAnimeRecs() {
      const seed = mostRecentOf("anime");
      if (!seed) {
        if (!cancelled) setAnimeRecs(null);
        return;
      }
      try {
        const infoRes = await fetch(`${API_BASE}/info/${seed!.anilistId}`);
        const infoData = await infoRes.json();
        const seedDNA = inferStoryDNA({
          genres: (infoData?.genres || []).map((g: string) => String(g).toLowerCase()),
          overview: infoData?.description,
        });

        // NETFLIX-SCALE: use the full currentFeed + trending pool (now 100+
        // items from the multi-page fetch) instead of just a tiny slice.
        const pool = [...currentFeed, ...trending].filter(
          (item) => !isTmdbResult(item) && String(item.id) !== String(seed!.anilistId)
        );
        const deduped = Array.from(new Map(pool.map((item) => [String(item.id), item])).values());

        // Content-similarity (StoryDNA cosine) replaces the old plain
        // genre-overlap count; no collaborative pool exists for anime here,
        // so hybridScore falls back to a popularity-based proxy for that term.
        const ranked = deduped
          .map((item) => ({
            item,
            dna: inferStoryDNA(item),
            score: hybridScore({
              candidateDNA: inferStoryDNA(item),
              todayTasteTarget: seedDNA,
              isInCollaborativePool: false,
              popularityScore: Math.min(1, (item.averageScore || 0) / 100),
              sessionMood: moodForScoring,
              impression: impressionMap[`anime-${item.id}`],
              alreadyWatched: false,
            }),
          }))
          .filter((x) => x.score > 0.25)
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map((x) => x.item);

        const safeScored = filterForKids(ranked, isKids);
        if (!cancelled) setAnimeRecs(safeScored.length > 0 ? { seedTitle: seed!.animeTitle, items: safeScored } : null);
      } catch {
        if (!cancelled) setAnimeRecs(null);
      }
    }

    loadMovieRecs();
    loadTvRecs();
    loadAnimeRecs();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchHistory, isKids, currentFeed, trending]);

  // ── Taste Drift: fold this session's signal into the permanent profile ──
  // We don't have direct genre/synopsis data on WatchHistoryItem itself, so
  // this approximates "what the viewer likes" from the recommendation pools
  // TMDB/our own anime-genre-overlap logic already judged similar to what
  // they actually watched — a real, honest proxy rather than a fetch-every-
  // watched-title-again approach.
  useEffect(() => {
    if (!currentProfile) return;
    const pooled = [...(movieRecs?.items || []), ...(tvRecs?.items || []), ...(animeRecs?.items || [])].slice(0, 24);
    if (pooled.length === 0) return;

    const freshDNA = averageDNA(pooled.map((item) => ({ dna: inferStoryDNA(item) })));
    const updated = updatePermanentTaste(currentProfile.id, freshDNA);
    setPermanentTasteDNA(updated.permanent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieRecs, tvRecs, animeRecs, currentProfile]);

  // "Because you watched X" rows, one per media type, only rendered once
  // there's actually a seeded row for it.
  const becauseYouWatchedRows = useMemo(
    () => [
      { row: tvRecs ? { ...tvRecs, items: excludeBlockedShows(tvRecs.items) } : null, label: "TV Shows" },
      { row: movieRecs ? { ...movieRecs, items: excludeBlockedShows(movieRecs.items) } : null, label: "Movies" },
      { row: animeRecs ? { ...animeRecs, items: excludeBlockedShows(animeRecs.items) } : null, label: "Anime" },
    ],
    [tvRecs, movieRecs, animeRecs]
  );

  // Adaptive contextual rows — generated fresh each visit from session mood
  // + Taste Drift, not hardcoded labels.
  const adaptiveRows = useMemo(
    () => [
      { items: relaxBeforeBedRow, label: "Relax Before Bed" },
      { items: weekendBingeRow, label: "Fast-Paced Weekend Binge" },
      { items: underTheRadarRow, label: "Under the Radar" },
      { items: awardWinnersRow, label: "Award Winners You Missed" },
    ],
    [relaxBeforeBedRow, weekendBingeRow, underTheRadarRow, awardWinnersRow]
  );

  const isInitialLoad = loading || (searchingLoading && searchPage === 1) || showcaseRatingLoading;

  return (
    <>
      <main className="relative min-h-screen bg-[#090a0f] text-[#f2f0ec] font-sans antialiased selection:bg-orange-500 selection:text-white pb-20 overflow-x-hidden">
        <style jsx global>{`
          /* Mobile touch polish: kills the gray tap-flash Android/iOS
             Chrome shows on tap, and touch-action: manipulation removes
             the ~300ms double-tap-zoom delay on buttons/links so taps
             register instantly instead of waiting to see if it's a
             double-tap. -webkit-overflow-scrolling gives momentum
             scrolling on iOS Safari instead of the stock choppy scroll. */
          * {
            -webkit-tap-highlight-color: transparent;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            -moz-user-select: none;
            user-select: none;
          }
          a, button, input, textarea, [role="button"] {
            touch-action: manipulation;
          }
          input, textarea {
            -webkit-user-select: text;
            user-select: text;
          }
          img {
            -webkit-user-drag: none;
            user-drag: none;
          }
          html, body {
            -webkit-overflow-scrolling: touch;
          }
          .overflow-x-auto, .overflow-y-auto {
            -webkit-overflow-scrolling: touch;
          }
          /* Horizontal shelves (Continue Watching, recommendation rows) only
             contain horizontal overscroll. Setting overscroll-behavior:
             contain on both axes here was the cause of vertical page
             scrolling getting "stuck" whenever the cursor happened to be
             over one of these rows — a container with zero vertical scroll
             range still counts as sitting at its scroll boundary on the y
             axis, so contain was silently swallowing the vertical scroll
             gesture instead of letting it pass through to the page. */
          .overflow-x-auto {
            overscroll-behavior-x: contain;
          }
          .overflow-y-auto {
            overscroll-behavior-y: contain;
          }
          @keyframes dropdownOpen {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes shimmer {
            from { background-position: -400px 0; }
            to { background-position: 400px 0; }
          }
          .shimmer {
            background: linear-gradient(
              100deg,
              rgba(255,255,255,0.03) 30%,
              rgba(255,255,255,0.08) 50%,
              rgba(255,255,255,0.03) 70%
            );
            background-size: 800px 100%;
            animation: shimmer 1.6s ease-in-out infinite;
          }
        `}</style>

        {needsPasswordSetup && (
          <div
            style={{ top: "calc(4rem + var(--sa-banner-h, 0px))" }}
            className="fixed inset-x-0 z-40 bg-orange-500 text-black"
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-2 flex items-center justify-between gap-4 flex-wrap">
              <p className="text-xs sm:text-sm font-semibold">
                No password for this account — would you like to make one?
              </p>
              <button
                onClick={openSetPassword}
                className="text-xs font-bold uppercase tracking-widest bg-black text-white px-3 py-1.5 rounded hover:bg-neutral-900 transition cursor-pointer flex-shrink-0"
              >
                Set Password
              </button>
            </div>
          </div>
        )}
        
        {/* GLOBAL NAVIGATION HEADER */}
        <TopBar
          onLogoClick={() => { setActiveCategory("recommendations"); setSearchQuery(""); }}
          navItems={[
            { key: "recommendations", label: "Home", onClick: () => { setActiveCategory("recommendations"); setSearchQuery(""); } },
            { key: "trending", label: "Trending", onClick: () => { setActiveCategory("trending"); setSearchQuery(""); } },
            { key: "upcoming", label: "Upcoming", onClick: () => { setActiveCategory("upcoming"); setSearchQuery(""); } },
            { key: "popular", label: "Popular", onClick: () => { setActiveCategory("popular"); setSearchQuery(""); } },
          ]}
          activeKey={!isSearching ? activeCategory : undefined}
          searchMode="live"
          searchPlaceholder="Search movies, TV or anime..."
          searchValue={searchQuery}
          onSearchChange={handleSearchChange}
          profileMode="dropdown"
          profile={currentProfile}
          onSwitchProfile={switchProfile}
          onLogout={logout}
        />

        {/* MOBILE CATEGORY SELECTOR */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 h-14 bg-[#090a0f]/96 backdrop-blur-md border-t border-white/10 z-50 flex items-center justify-around text-[11px] font-medium text-neutral-400 px-2">
          <button 
            onClick={() => { setActiveCategory("recommendations"); setSearchQuery(""); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
            className={`flex flex-col items-center space-y-0.5 transition-all duration-300 ${activeCategory === "recommendations" && !isSearching ? "text-orange-500 font-bold" : "hover:text-neutral-200"}`}
          >
            <span>Home</span>
          </button>
          <button 
            onClick={() => { setActiveCategory("trending"); setSearchQuery(""); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
            className={`flex flex-col items-center space-y-0.5 transition-all duration-300 ${activeCategory === "trending" && !isSearching ? "text-orange-500 font-bold" : "hover:text-neutral-200"}`}
          >
            <span>Trending</span>
          </button>
          <button 
            onClick={() => { setActiveCategory("upcoming"); setSearchQuery(""); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
            className={`flex flex-col items-center space-y-0.5 transition-all duration-300 ${activeCategory === "upcoming" && !isSearching ? "text-orange-500 font-bold" : "hover:text-neutral-200"}`}
          >
            <span>Upcoming</span>
          </button>
          <button 
            onClick={() => { setActiveCategory("popular"); setSearchQuery(""); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
            className={`flex flex-col items-center space-y-0.5 transition-all duration-300 ${activeCategory === "popular" && !isSearching ? "text-orange-500 font-bold" : "hover:text-neutral-200"}`}
          >
            <span>Popular</span>
          </button>
        </div>

        {/* SPOTLIGHT BANNER SLIDER */}
        {!isSearching && (
          <HeroSlider
            loading={trendingRatingLoading}
            items={topFiveTrending}
            activeIndex={activeHeroIndex}
            onDotClick={setActiveHeroIndex}
            onPauseChange={setHeroPaused}
          />
        )}

        {/* CONTAINER SHELF GRIDS */}
        <div className={`relative z-20 px-4 sm:px-6 md:px-12 space-y-12 md:space-y-16 ${!isSearching && (topFiveTrending.length > 0 || trendingRatingLoading) ? "-mt-16 md:-mt-28" : "pt-[calc(5rem+var(--sa-banner-h,0px))] md:pt-[calc(6rem+var(--sa-banner-h,0px))]"}`}>
          
          {/* Mobile input field block */}
          <div className="sm:hidden block relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <img src="/Assets/search-icon.png" alt="Search" className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90" />
            </div>
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search movies, TV or anime..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4 p-2.5 rounded-lg bg-[#12151b] border border-white/10 text-[#f2f0ec] text-sm focus:border-orange-500 transition-all duration-300"
            />
          </div>

          {/* WATCH HISTORY */}
          {!isSearching && <WatchHistory items={watchHistory} />}

          {/* "BECAUSE YOU WATCHED X" ROWS */}
          {!isSearching &&
            becauseYouWatchedRows.map(({ row, label }) => (
              <RecommendationRow
                key={label}
                label={label}
                seedTitle={row?.seedTitle}
                items={row?.items || []}
                onHoverStart={handleCardHoverStart}
                onHoverEnd={handleCardHoverEnd}
                onCardClick={handleCardClick}
              />
            ))}

          {/* ADAPTIVE CONTEXTUAL ROWS */}
          {!isSearching &&
            adaptiveRows.map(({ items, label }) => (
              <RecommendationRow
                key={label}
                label={label}
                items={items}
                onHoverStart={handleCardHoverStart}
                onHoverEnd={handleCardHoverEnd}
                onCardClick={handleCardClick}
              />
            ))}

          {isInitialLoad ? (
            <ShowcaseSkeleton />
          ) : isSearching ? (
            <SearchResults
              animeResults={animeSearchResults}
              tvResults={tvSearchResults}
              movieResults={movieSearchResults}
              hasMoreResults={hasMoreResults}
              searchResultsCount={searchResults.length}
              resultsPerPage={RESULTS_PER_PAGE}
              loadingMore={searchingLoading}
              onLoadMore={handleLoadMoreSearch}
              onHoverStart={handleCardHoverStart}
              onHoverEnd={handleCardHoverEnd}
              onCardClick={handleCardClick}
            />
          ) : (
            <FeedGrid
              headerTitle={getHeaderTitle()}
              items={standardShowcaseList}
              onHoverStart={handleCardHoverStart}
              onHoverEnd={handleCardHoverEnd}
              onCardClick={handleCardClick}
            />
          )}

        </div>
      </main>
    </>
  );
}

export default function HomePage() {
  return (
    <ProfileGate>
      <HomePageContent />
    </ProfileGate>
  );
}

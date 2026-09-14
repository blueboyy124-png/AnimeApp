"use client";

import { useState, useEffect, useRef, use } from "react";
import Link from "next/link";
import { getApiBaseUrl } from "../../utils/api";
import TopBar from "../../components/TopBar";

interface ScoreSet {
  imdb?: string;
  rt?: string;
  tmdb?: string;
}

interface AnimeInfo {
  id: string | number;
  title: {
    english?: string;
    romaji?: string;
  };
  description: string;
  coverImage: {
    extraLarge?: string;
    large?: string;
  };
  genres?: string[];
  year?: string;
  runtime?: string;
  ageRating?: string;
  scores?: ScoreSet;
  trailerUrl?: string;
}

interface EpisodeData {
  id: string;
  number: number;
  title?: string;
  description?: string;
  image?: string;
  airDate?: string;
  rating?: number;
  runtimeMinutes?: number;
}

interface CastMember {
  id: number;
  name: string;
  character?: string;
  profile?: string;
}

interface RelatedTitle {
  id: number;
  title: string;
  poster?: string;
  mediaType: "tv" | "movie";
  rating?: string;
}

interface ReviewItem {
  id: string;
  author: string;
  content: string;
  rating?: number;
}

interface CompanyItem {
  id: number;
  name: string;
  logo?: string;
}

interface SearchResultItem {
  id: string;
  title: string;
  poster?: string;
  meta?: string;
}

interface SearchResults {
  anime: SearchResultItem[];
  movies: SearchResultItem[];
  tv: SearchResultItem[];
}

interface SeasonInfo {
  number: number;
  name: string;
  poster?: string;
  episodeCount?: number;
  airDate?: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

type ViewStyle = "compact" | "detailed";
type ResolvedMedia = { tmdbId: string; mediaType: "tv" | "movie" } | null;

const TMDB_API_KEY = "e0554f6521da4365d4a36ea7ff17ae51";
const OMDB_API_KEY = "68d53c36";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const fallbackGlobalImage =
  "https://images.unsplash.com/photo-1574375927938-d5a98e8edd86?q=80&w=600&auto=format&fit=crop";

async function tmdbGet(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_API_KEY}&language=en-US`);
  const data = await res.json();
  return { ok: res.ok, data };
}

// ---- TMDB → AniList bridge (Fix B) ------------------------------------------------
// TMDB ids and AniList ids never correspond to each other, even for the exact
// same show — there's no numeric relationship to exploit. The only reliable
// bridge between the two catalogs is the title itself: for every TMDB tv/movie
// result we search our own anime backend (the same `/search/:query` endpoint
// already used for the global search overlay below) for an EXACT title match,
// and if one exists, that AniList id — and its real episode list/slugs — takes
// over for episode data and streaming. TMDB metadata (poster art, trailer,
// cast, reviews) is still kept for the page's visual polish either way.
//
// This intentionally does NOT gate on TMDB's own "Animation" genre tag —
// TMDB tags anime inconsistently (plenty of real anime only carry genres
// like "Action & Adventure" with no "Animation" entry), so gating on it was
// silently skipping the AniList lookup for real anime titles and leaving
// them stuck on the generic TMDB pipeline.

// Same "flatten whatever shape the backend wrapped this in" normalization
// used elsewhere for this backend's payloads (`results.results` / `results`
// / bare array).
function extractAnimeSearchResults(data: any): any[] {
  if (data && data.results && Array.isArray(data.results.results)) return data.results.results;
  if (data && Array.isArray(data.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

function normalizeAnimeTitle(str: string): string {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getAnimeResultTitle(item: any): string {
  if (typeof item?.title === "string") return item.title;
  if (item?.title && typeof item.title === "object") {
    return item.title.english || item.title.romaji || item.title.userPreferred || "";
  }
  return item?.name || "";
}

// Searches the anime backend by the TMDB title and returns the matching
// AniList id, or null if nothing lines up / the backend is unreachable.
//
// Requires an EXACT normalized-title match. This is called unconditionally
// for every TMDB tv/movie (see loadTmdbMedia) rather than being gated behind
// a TMDB "Animation" genre check, because TMDB tags anime inconsistently —
// plenty of real anime (e.g. Solo Leveling) only carry genres like
// "Action & Adventure" / "Sci-Fi & Fantasy" with no "Animation" entry at
// all, which was silently skipping resolution entirely and leaving the page
// on the generic TMDB pipeline. Since there's no genre gate to filter out
// unrelated titles anymore, a fuzzy "just take the top result" fallback
// would start misrouting real live-action shows onto whatever anime
// happens to rank first for a loose title match — so no exact match means
// no override, full stop.
async function resolveAnilistIdForTmdbTitle(backendApi: string, title: string): Promise<string | null> {
  const query = title?.trim();
  if (!query) return null;

  try {
    const res = await fetch(`${backendApi}/search/${encodeURIComponent(query)}`);
    if (!res.ok) return null;

    const results = extractAnimeSearchResults(await res.json());
    if (results.length === 0) return null;

    const normalizedQuery = normalizeAnimeTitle(query);
    const exactMatch = results.find((r) => normalizeAnimeTitle(getAnimeResultTitle(r)) === normalizedQuery);

    return exactMatch?.id != null ? String(exactMatch.id) : null;
  } catch {
    // Backend unreachable / bad response is a normal fallback path here,
    // not an error worth surfacing — callers just stay on the TMDB flow.
    return null;
  }
}


// Shared parser for this backend's `/episodes/:id` payload — used by the
// native AniList routine further down AND by the TMDB-override path above,
// so a title resolved onto an AniList id gets the exact same real episode
// list (provider, slug, absolute episode numbering) a native /anime/{id}
// visit would get, instead of TMDB's own (unrelated) episode numbering.
//
// Also returns *which* provider key was actually selected (gogoanime / zoro /
// whatever came back first). buildWatchHref needs the real provider — the
// same way WatchHistory.tsx stores `item.provider` explicitly instead of
// assuming — because a title that only exists on zoro but gets routed with
// `provider=gogoanime` in the URL is the same class of bug as sending an
// AniList id through the TMDB-shaped query.
type AnimeEpisodesResult = { episodes: any[]; provider: string | null };

function parseAnimeEpisodesPayload(epData: any): AnimeEpisodesResult {
  if (epData && epData.results && epData.results.providers) {
    const providers = epData.results.providers;
    const providerKey: string | null = providers.gogoanime
      ? "gogoanime"
      : providers.zoro
      ? "zoro"
      : Object.keys(providers)[0] || null;
    const targetProvider = providerKey ? providers[providerKey] : undefined;
    if (targetProvider && targetProvider.episodes && Array.isArray(targetProvider.episodes.sub)) {
      return {
        episodes: [...targetProvider.episodes.sub].sort((a, b) => a.number - b.number),
        provider: providerKey,
      };
    }
    return { episodes: [], provider: null };
  }
  if (epData && Array.isArray(epData.results)) return { episodes: epData.results, provider: null };
  return { episodes: [], provider: null };
}

// ---- Watch-progress persistence -------------------------------------------------
// The player at /watch is expected to write into this same localStorage key as a
// viewer progresses through an episode, so this page can render "Continue Watching"
// and per-episode progress bars without a backend round trip.
//
// Key:   streamanime:progress:<titleId>
// Shape: {
//   "<season>-<episode>": { percent: number, positionSeconds?: number, updatedAt: number },
//   lastWatched?: { season: number; episode: number }
// }
const PROGRESS_KEY_PREFIX = "streamanime:progress:";
const CONTINUE_WATCHING_THRESHOLD = 92; // percent complete before we consider an episode "finished"

type ProgressEntry = { percent: number; positionSeconds?: number; updatedAt: number };
type ProgressMap = Record<string, ProgressEntry> & { lastWatched?: { season: number; episode: number } };

function progressKey(season: number, episode: number) {
  return `${season}-${episode}`;
}

function loadProgressMap(titleId: string): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${PROGRESS_KEY_PREFIX}${titleId}`);
    return raw ? (JSON.parse(raw) as ProgressMap) : {};
  } catch {
    return {};
  }
}

function formatResumeTime(seconds?: number) {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function AnimeDetailPage({ params }: PageProps) {
  const { id } = use(params);

  const [info, setInfo] = useState<AnimeInfo | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [resolvedTmdb, setResolvedTmdb] = useState<ResolvedMedia>(null);
  // Set once loadTmdbMedia detects the TMDB title is actually Animation and
  // successfully resolves a matching AniList id via the local metadata
  // service. When present, buildWatchHref routes through the native anime
  // pipeline instead of the generic TMDB one.
  const [resolvedAnilistId, setResolvedAnilistId] = useState<string | null>(null);
  // Which provider (gogoanime / zoro / etc) the currently-loaded episode list
  // actually came from — set by parseAnimeEpisodesPayload so buildWatchHref
  // never has to guess/hardcode it. Applies to both the native anime route
  // and the TMDB → AniList override route, since both share that parser.
  const [resolvedProvider, setResolvedProvider] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [seasonLoading, setSeasonLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isBookmarked, setIsBookmarked] = useState<boolean>(false);
  const [isWatched, setIsWatched] = useState<boolean>(false);

  // Layout presentation toggler state
  const [viewStyle, setViewStyle] = useState<ViewStyle>("detailed");

  // Pagination ranges for very long seasons
  const [activeRangeIndex, setActiveRangeIndex] = useState<number>(0);

  // Continue Watching / per-episode progress (read from localStorage; written by /watch)
  const [progressMap, setProgressMap] = useState<ProgressMap>({});

  // Discovery sections
  const [cast, setCast] = useState<CastMember[]>([]);
  const [related, setRelated] = useState<RelatedTitle[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [companies, setCompanies] = useState<CompanyItem[]>([]);

  // Hero background video: fade from poster into a muted autoplaying trailer
  const [heroVideoReady, setHeroVideoReady] = useState<boolean>(false);

  // Inline trailer modal (Watch Trailer no longer navigates away from the page)
  const [trailerModalOpen, setTrailerModalOpen] = useState<boolean>(false);

  // Global search overlay
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<SearchResults>({ anime: [], movies: [], tv: [] });
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 350);

  const BACKEND_API = getApiBaseUrl();

  const cleanDescription = (htmlStr?: string) => {
    if (!htmlStr) return "No summary available for this release.";
    return htmlStr.replace(/<\/?[^>]+(>|$)/g, "");
  };

  // ---- Fetch a single season's episode list from TMDB ----
  async function loadTmdbSeasonEpisodes(tmdbId: string, seasonNumber: number, showPoster?: string) {
    setSeasonLoading(true);
    setActiveRangeIndex(0);
    try {
      const { ok, data } = await tmdbGet(`/tv/${tmdbId}/season/${seasonNumber}`);
      const rawEpisodes = ok && Array.isArray(data.episodes) ? data.episodes : [];
      setEpisodes(
        rawEpisodes.map((ep: any) => ({
          id: String(ep.episode_number),
          number: ep.episode_number,
          title: ep.name || `Episode ${ep.episode_number}`,
          description: ep.overview || "No synopsis has been published for this episode yet.",
          image: ep.still_path ? `${TMDB_IMG}/w300${ep.still_path}` : showPoster || fallbackGlobalImage,
          airDate: ep.air_date,
          rating: typeof ep.vote_average === "number" && ep.vote_average > 0 ? ep.vote_average : undefined,
          runtimeMinutes: typeof ep.runtime === "number" && ep.runtime > 0 ? ep.runtime : undefined,
        }))
      );
    } catch {
      setEpisodes([]);
    } finally {
      setSeasonLoading(false);
    }
  }

  // ---- Shared loader for anything backed by a real TMDB id (tv or movie) ----
  async function loadTmdbMedia(tmdbId: string, mediaType: "tv" | "movie") {
    setResolvedTmdb({ tmdbId, mediaType });

    if (mediaType === "tv") {
      const [{ ok: showOk, data: showData }, contentRatingsRes, externalIdsRes, videosRes] = await Promise.all([
        tmdbGet(`/tv/${tmdbId}`),
        tmdbGet(`/tv/${tmdbId}/content_ratings`),
        tmdbGet(`/tv/${tmdbId}/external_ids`),
        tmdbGet(`/tv/${tmdbId}/videos`),
      ]);

      if (!showOk || !showData) {
        setInfo(null);
        return;
      }

      const poster = showData.poster_path ? `${TMDB_IMG}/w780${showData.poster_path}` : fallbackGlobalImage;
      const posterLarge = showData.poster_path ? `${TMDB_IMG}/w500${showData.poster_path}` : fallbackGlobalImage;

      const usCert = contentRatingsRes.data?.results?.find((r: any) => r.iso_3166_1 === "US");
      const runtimeMins = Array.isArray(showData.episode_run_time) ? showData.episode_run_time[0] : undefined;
      const imdbId = externalIdsRes.data?.imdb_id as string | undefined;

      let omdbScores: { imdb?: string; rt?: string } = {};
      if (imdbId) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const omdbRes = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`, {
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const omdbData = await omdbRes.json();
          if (omdbData?.Response !== "False") {
            omdbScores.imdb = omdbData.imdbRating && omdbData.imdbRating !== "N/A" ? omdbData.imdbRating : undefined;
            const rt = (omdbData.Ratings || []).find((r: any) => r.Source === "Rotten Tomatoes");
            omdbScores.rt = rt?.Value;
          }
        } catch {
          // ratings are a nice-to-have, ignore failures silently
        }
      }

      const trailer = (videosRes.data?.results || []).find(
        (v: any) => v.site === "YouTube" && v.type === "Trailer"
      );

      setInfo({
        id: tmdbId,
        title: { english: showData.name, romaji: showData.name },
        description: showData.overview || "No plot description available.",
        coverImage: { extraLarge: poster, large: posterLarge },
        genres: Array.isArray(showData.genres) ? showData.genres.map((g: any) => g.name) : ["Entertainment"],
        year: showData.first_air_date ? showData.first_air_date.slice(0, 4) : undefined,
        runtime: runtimeMins ? `${runtimeMins}m` : undefined,
        ageRating: usCert?.rating || undefined,
        scores: {
          imdb: omdbScores.imdb,
          rt: omdbScores.rt,
          tmdb: typeof showData.vote_average === "number" && showData.vote_average > 0
            ? showData.vote_average.toFixed(1)
            : undefined,
        },
        trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : undefined,
      });

      // This TMDB show may actually be anime — try to resolve it onto the
      // native AniList pipeline by title before we finish loading. TMDB
      // and AniList ids never correspond to each other even for the same
      // show, so this is a name match against our own anime backend, not
      // an id lookup. Deliberately NOT gated behind a TMDB "Animation"
      // genre check anymore — TMDB tags anime inconsistently (e.g. Solo
      // Leveling carries no "Animation" genre entry at all), which was
      // silently skipping this lookup and leaving titles stuck on the
      // generic TMDB pipeline. resolveAnilistIdForTmdbTitle requires an
      // exact title match, so unrelated live-action shows safely fall
      // through to the standard TMDB flow below instead.
      const matchedAnilistId = await resolveAnilistIdForTmdbTitle(BACKEND_API, showData.name);
      setResolvedAnilistId(matchedAnilistId);

      if (matchedAnilistId) {
        // Anime doesn't get TMDB's season split in this app — episodes are
        // a flat, absolutely-numbered list, and only the anime backend
        // knows the real provider/slug needed to actually stream them.
        setSeasons([]);
        try {
          const animeEpRes = await fetch(`${BACKEND_API}/episodes/${matchedAnilistId}`);
          if (animeEpRes.ok) {
            const parsed = parseAnimeEpisodesPayload(await animeEpRes.json());
            setEpisodes(parsed.episodes);
            setResolvedProvider(parsed.provider);
          } else {
            setEpisodes([]);
            setResolvedProvider(null);
          }
        } catch {
          setEpisodes([]);
          setResolvedProvider(null);
        }
      } else {
        const rawSeasons = Array.isArray(showData.seasons) ? showData.seasons : [];
        const realSeasons = rawSeasons.filter((s: any) => s.season_number > 0);
        const seasonPool = realSeasons.length > 0 ? realSeasons : rawSeasons;

        const mappedSeasons: SeasonInfo[] = seasonPool
          .map((s: any) => ({
            number: s.season_number,
            name: s.name || `Season ${s.season_number}`,
            poster: s.poster_path ? `${TMDB_IMG}/w400${s.poster_path}` : poster,
            episodeCount: s.episode_count,
            airDate: s.air_date,
          }))
          .sort((a: SeasonInfo, b: SeasonInfo) => a.number - b.number);

        setSeasons(mappedSeasons);
        const firstSeasonNumber = mappedSeasons[0]?.number ?? 1;
        setSelectedSeason(firstSeasonNumber);
        await loadTmdbSeasonEpisodes(tmdbId, firstSeasonNumber, posterLarge);
      }

      const networkCompanies = Array.isArray(showData.networks) ? showData.networks : [];
      const prodCompanies = Array.isArray(showData.production_companies) ? showData.production_companies : [];
      setCompanies(
        [...networkCompanies, ...prodCompanies]
          .filter((c: any) => c && c.name)
          .slice(0, 6)
          .map((c: any) => ({ id: c.id, name: c.name, logo: c.logo_path ? `${TMDB_IMG}/w200${c.logo_path}` : undefined }))
      );

      loadTmdbExtras(tmdbId, "tv");
    } else {
      const [{ ok: movieOk, data: movieData }, releaseDatesRes, externalIdsRes, videosRes] = await Promise.all([
        tmdbGet(`/movie/${tmdbId}`),
        tmdbGet(`/movie/${tmdbId}/release_dates`),
        tmdbGet(`/movie/${tmdbId}/external_ids`),
        tmdbGet(`/movie/${tmdbId}/videos`),
      ]);

      if (!movieOk || !movieData) {
        setInfo(null);
        return;
      }

      const poster = movieData.poster_path ? `${TMDB_IMG}/w780${movieData.poster_path}` : fallbackGlobalImage;
      const posterLarge = movieData.poster_path ? `${TMDB_IMG}/w500${movieData.poster_path}` : fallbackGlobalImage;

      const usRelease = releaseDatesRes.data?.results?.find((r: any) => r.iso_3166_1 === "US");
      const cert = usRelease?.release_dates?.find((d: any) => d.certification)?.certification;
      const imdbId = externalIdsRes.data?.imdb_id as string | undefined;

      let omdbScores: { imdb?: string; rt?: string } = {};
      if (imdbId) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const omdbRes = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${imdbId}`, {
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const omdbData = await omdbRes.json();
          if (omdbData?.Response !== "False") {
            omdbScores.imdb = omdbData.imdbRating && omdbData.imdbRating !== "N/A" ? omdbData.imdbRating : undefined;
            const rt = (omdbData.Ratings || []).find((r: any) => r.Source === "Rotten Tomatoes");
            omdbScores.rt = rt?.Value;
          }
        } catch {
          // optional enrichment only
        }
      }

      const trailer = (videosRes.data?.results || []).find(
        (v: any) => v.site === "YouTube" && v.type === "Trailer"
      );

      setInfo({
        id: tmdbId,
        title: { english: movieData.title, romaji: movieData.title },
        description: movieData.overview || "No plot description available.",
        coverImage: { extraLarge: poster, large: posterLarge },
        genres: Array.isArray(movieData.genres) ? movieData.genres.map((g: any) => g.name) : ["Entertainment"],
        year: movieData.release_date ? movieData.release_date.slice(0, 4) : undefined,
        runtime: movieData.runtime ? `${movieData.runtime}m` : undefined,
        ageRating: cert || undefined,
        scores: {
          imdb: omdbScores.imdb,
          rt: omdbScores.rt,
          tmdb: typeof movieData.vote_average === "number" && movieData.vote_average > 0
            ? movieData.vote_average.toFixed(1)
            : undefined,
        },
        trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : undefined,
      });

      // Same TMDB → AniList bridge as the TV branch above: match by exact
      // title against the anime backend, not by id or genre.
      const matchedAnilistId = await resolveAnilistIdForTmdbTitle(BACKEND_API, movieData.title);
      setResolvedAnilistId(matchedAnilistId);

      setSeasons([]);
      const fallbackMovieEpisode = [
        {
          id: "1",
          number: 1,
          title: movieData.title || "Full Feature Film",
          description: movieData.overview || "Full length feature presentation.",
          image: posterLarge,
        },
      ];

      if (matchedAnilistId) {
        try {
          const animeEpRes = await fetch(`${BACKEND_API}/episodes/${matchedAnilistId}`);
          const animeEpisodes = animeEpRes.ok ? parseAnimeEpisodesPayload(await animeEpRes.json()).episodes : [];
          // A genuine provider entry always beats the synthetic placeholder
          // above, since only the former carries a real streamable slug —
          // but keep the placeholder as a fallback if the anime backend
          // matched the title yet has no episodes on file.
          setEpisodes(animeEpisodes.length > 0 ? animeEpisodes : fallbackMovieEpisode);
        } catch {
          setEpisodes(fallbackMovieEpisode);
        }
      } else {
        setEpisodes(fallbackMovieEpisode);
      }

      const prodCompanies = Array.isArray(movieData.production_companies) ? movieData.production_companies : [];
      setCompanies(
        prodCompanies
          .filter((c: any) => c && c.name)
          .slice(0, 6)
          .map((c: any) => ({ id: c.id, name: c.name, logo: c.logo_path ? `${TMDB_IMG}/w200${c.logo_path}` : undefined }))
      );

      loadTmdbExtras(tmdbId, "movie");
    }
  }

  // ---- Non-blocking fetch of cast, recommendations, and reviews ----
  // Fired without awaiting from loadTmdbMedia so the main title/episode UI never
  // waits on this "nice to have" discovery content.
  async function loadTmdbExtras(tmdbId: string, mediaType: "tv" | "movie") {
    try {
      const [creditsRes, recsRes, reviewsRes] = await Promise.all([
        tmdbGet(`/${mediaType}/${tmdbId}/credits`),
        tmdbGet(`/${mediaType}/${tmdbId}/recommendations`),
        tmdbGet(`/${mediaType}/${tmdbId}/reviews`),
      ]);

      const castList = Array.isArray(creditsRes.data?.cast) ? creditsRes.data.cast : [];
      setCast(
        castList.slice(0, 12).map((c: any) => ({
          id: c.id,
          name: c.name,
          character: c.character,
          profile: c.profile_path ? `${TMDB_IMG}/w200${c.profile_path}` : undefined,
        }))
      );

      const recList = Array.isArray(recsRes.data?.results) ? recsRes.data.results : [];
      setRelated(
        recList
          .filter((r: any) => r.poster_path)
          .slice(0, 12)
          .map((r: any) => ({
            id: r.id,
            title: r.name || r.title || "Untitled",
            poster: `${TMDB_IMG}/w300${r.poster_path}`,
            mediaType,
            rating: typeof r.vote_average === "number" && r.vote_average > 0 ? r.vote_average.toFixed(1) : undefined,
          }))
      );

      const reviewList = Array.isArray(reviewsRes.data?.results) ? reviewsRes.data.results : [];
      setReviews(
        reviewList.slice(0, 4).map((r: any) => ({
          id: r.id,
          author: r.author || "Anonymous",
          content: (r.content || "").slice(0, 320),
          rating: r.author_details?.rating || undefined,
        }))
      );
    } catch {
      // discovery sections are optional polish; fail silently
    }
  }

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setLoadError(null);
      setResolvedTmdb(null);
      setResolvedAnilistId(null);
      setResolvedProvider(null);
      setSeasons([]);

      try {
        const safeId = String(id || "").trim();
        const isTmdbNumericId = safeId.startsWith("tmdb-");
        const isImdbId = safeId.startsWith("tt");

        if (isTmdbNumericId) {
          const isTvShow = safeId.startsWith("tmdb-tv-");
          const tmdbId = safeId.replace(/^tmdb-(?:movie|tv)-/, "");
          await loadTmdbMedia(tmdbId, isTvShow ? "tv" : "movie");
        } else if (isImdbId) {
          // Try to resolve the IMDb id to a real TMDB entry first so we get
          // full season data, artwork, and trailers.
          const { ok, data } = await tmdbGet(`/find/${safeId}?external_source=imdb_id`);
          const tvMatch = ok ? data?.tv_results?.[0] : undefined;
          const movieMatch = ok ? data?.movie_results?.[0] : undefined;

          if (tvMatch) {
            await loadTmdbMedia(String(tvMatch.id), "tv");
          } else if (movieMatch) {
            await loadTmdbMedia(String(movieMatch.id), "movie");
          } else {
            // Fallback: plain OMDb lookup, no season browsing available.
            const infoRes = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${safeId}`);
            const infoData = await infoRes.json();

            if (infoData && infoData.Response !== "False") {
              const rt = (infoData.Ratings || []).find((r: any) => r.Source === "Rotten Tomatoes");
              setInfo({
                id: safeId,
                title: { english: infoData.Title, romaji: infoData.Title },
                description: infoData.Plot && infoData.Plot !== "N/A" ? infoData.Plot : "No plot description available.",
                coverImage: {
                  extraLarge: infoData.Poster !== "N/A" ? infoData.Poster : fallbackGlobalImage,
                  large: infoData.Poster !== "N/A" ? infoData.Poster : fallbackGlobalImage,
                },
                genres: infoData.Genre ? infoData.Genre.split(", ") : ["Entertainment"],
                year: infoData.Year,
                runtime: infoData.Runtime !== "N/A" ? infoData.Runtime : undefined,
                ageRating: infoData.Rated !== "N/A" ? infoData.Rated : undefined,
                scores: {
                  imdb: infoData.imdbRating !== "N/A" ? infoData.imdbRating : undefined,
                  rt: rt?.Value,
                },
              });
              setSeasons([]);
              setEpisodes([
                {
                  id: `watch/movie/${safeId}/1`,
                  number: 1,
                  title: infoData.Title || "Full Feature",
                  description: infoData.Plot !== "N/A" ? infoData.Plot : "Streaming media pipeline synchronized.",
                  image: infoData.Poster !== "N/A" ? infoData.Poster : fallbackGlobalImage,
                },
              ]);
            } else {
              setInfo(null);
            }
          }
        } else {
          // --- STANDARD ANILIST FETCH ROUTINE FOR REGULAR ANIME ---
          const infoRes = await fetch(`${BACKEND_API}/info/${safeId}`);

          if (!infoRes.ok) {
            throw new Error(
              `Anime info request failed: ${infoRes.status} ${infoRes.statusText} (${BACKEND_API}/info/${safeId})`
            );
          }

          const infoData = await infoRes.json();
          const resolvedInfo = infoData && infoData.results ? infoData.results : infoData;
          setInfo(resolvedInfo);
          setSeasons([]);

          const epRes = await fetch(`${BACKEND_API}/episodes/${safeId}`);

          if (!epRes.ok) {
            console.warn(`Episodes request failed: ${epRes.status} ${epRes.statusText}`);
            setEpisodes([]);
            setResolvedProvider(null);
          } else {
            const parsed = parseAnimeEpisodesPayload(await epRes.json());
            setEpisodes(parsed.episodes);
            setResolvedProvider(parsed.provider);
          }
        }
      } catch (err) {
        console.error("Failed to load title info:", err);
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Load Continue Watching / per-episode progress for this title
  useEffect(() => {
    setProgressMap(loadProgressMap(String(id)));
  }, [id]);

  // Reset and stage the hero's fade from poster -> autoplaying trailer
  useEffect(() => {
    setHeroVideoReady(false);
    if (!info?.trailerUrl) return;
    const t = setTimeout(() => setHeroVideoReady(true), 900);
    return () => clearTimeout(t);
  }, [info?.trailerUrl]);

  // Global search overlay: debounced live search grouped by Anime / Movies / TV
  useEffect(() => {
    if (!searchOpen) return;
    const query = debouncedSearchQuery.trim();
    if (!query) {
      setSearchResults({ anime: [], movies: [], tv: [] });
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    async function runSearch() {
      setSearchLoading(true);
      try {
        const [multiRes, animeRes] = await Promise.all([
          tmdbGet(`/search/multi?query=${encodeURIComponent(query)}`),
          // Assumes a `/search/:query` route mirroring this app's existing
          // `/info/:id` and `/episodes/:id` backend conventions; adjust if different.
          fetch(`${BACKEND_API}/search/${encodeURIComponent(query)}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);

        if (cancelled) return;

        const multiResults = Array.isArray(multiRes.data?.results) ? multiRes.data.results : [];
        const movies: SearchResultItem[] = multiResults
          .filter((r: any) => r.media_type === "movie" && r.poster_path)
          .slice(0, 6)
          .map((r: any) => ({
            id: `tmdb-movie-${r.id}`,
            title: r.title || r.name || "Untitled",
            poster: `${TMDB_IMG}/w200${r.poster_path}`,
            meta: r.release_date ? r.release_date.slice(0, 4) : undefined,
          }));
        const tv: SearchResultItem[] = multiResults
          .filter((r: any) => r.media_type === "tv" && r.poster_path)
          .slice(0, 6)
          .map((r: any) => ({
            id: `tmdb-tv-${r.id}`,
            title: r.name || r.title || "Untitled",
            poster: `${TMDB_IMG}/w200${r.poster_path}`,
            meta: r.first_air_date ? r.first_air_date.slice(0, 4) : undefined,
          }));

        const rawAnimeList = animeRes?.results ?? animeRes?.data ?? (Array.isArray(animeRes) ? animeRes : []);
        const anime: SearchResultItem[] = Array.isArray(rawAnimeList)
          ? rawAnimeList.slice(0, 6).map((a: any) => ({
              id: String(a.id),
              title: a.title?.english || a.title?.romaji || a.title || "Untitled",
              poster: a.coverImage?.large || a.coverImage?.extraLarge || a.image,
              meta: a.year ? String(a.year) : undefined,
            }))
          : [];

        setSearchResults({ anime, movies, tv });
      } catch {
        if (!cancelled) setSearchResults({ anime: [], movies: [], tv: [] });
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }
    runSearch();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery, searchOpen]);

  // Focus the search input as soon as the overlay opens; close on Escape
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    } else {
      setSearchQuery("");
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setTrailerModalOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  function handleSelectSeason(seasonNumber: number) {
    if (seasonNumber === selectedSeason || !resolvedTmdb) return;
    setSelectedSeason(seasonNumber);
    loadTmdbSeasonEpisodes(resolvedTmdb.tmdbId, seasonNumber, info?.coverImage?.large);
  }

  function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      (navigator as any).share({ title: info?.title?.english || "Check this out", url }).catch(() => {});
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url);
    }
  }

  function handleTrailer() {
    if (info?.trailerUrl) {
      setTrailerModalOpen(true);
    } else {
      const q = encodeURIComponent(`${info?.title?.english || info?.title?.romaji || ""} trailer`);
      window.open(`https://www.youtube.com/results?search_query=${q}`, "_blank", "noopener,noreferrer");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-[#0a0806] text-neutral-100 flex flex-col items-center justify-center space-y-4 font-sans">
        <div className="w-7 h-7 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-[10px] font-mono tracking-[0.2em] text-neutral-600 uppercase">Loading title details</p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen w-full bg-[#0a0806] text-neutral-100 flex flex-col items-center justify-center font-sans">
        <div className="bg-neutral-900/40 border border-neutral-800/60 rounded-xl p-12 text-center max-w-sm space-y-2">
          <p className="text-neutral-300 font-semibold text-sm">We couldn&apos;t find that title</p>
          <p className="text-[12px] text-neutral-500 leading-relaxed">
            {loadError ?? "It may have been removed, or the link is out of date."}
          </p>
          <Link
            href="/"
            className="inline-block mt-3 text-[11px] font-mono tracking-wider uppercase text-orange-500 hover:text-orange-400 transition"
          >
            ← Back to browse
          </Link>
        </div>
      </div>
    );
  }

  const totalEpisodesCount = episodes.length;
  const chunkRanges: { start: number; end: number; label: string }[] = [];

  if (totalEpisodesCount > 30) {
    const incrementStep = totalEpisodesCount > 110 ? 100 : 30;
    for (let i = 0; i < totalEpisodesCount; i += incrementStep) {
      const rangeStart = i + 1;
      const rangeEnd = Math.min(i + incrementStep, totalEpisodesCount);
      chunkRanges.push({ start: rangeStart, end: rangeEnd, label: `${rangeStart}-${rangeEnd}` });
    }
  }

  const currentDisplayedEpisodes =
    chunkRanges.length > 0
      ? episodes.slice(chunkRanges[activeRangeIndex].start - 1, chunkRanges[activeRangeIndex].end)
      : episodes;

  const showSeasonPicker = seasons.length > 1;
  const activeSeasonMeta = seasons.find((s) => s.number === selectedSeason);
  const isMovieTitle = resolvedTmdb?.mediaType === "movie";
  const isSingleEpisode = !isMovieTitle && totalEpisodesCount === 1;
  const catalogLabel = isMovieTitle
    ? "Full Feature"
    : isSingleEpisode
    ? "Single Episode"
    : showSeasonPicker
    ? activeSeasonMeta?.name || `Season ${selectedSeason}`
    : "Episodes";
  const hasAnyScore = !!(info.scores?.imdb || info.scores?.rt || info.scores?.tmdb);
  const playButtonLabel = isMovieTitle ? "Play Movie" : isSingleEpisode ? "Play" : "Play Episode 1";
  const episodeCountLabel = isMovieTitle
    ? "Movie"
    : isSingleEpisode
    ? "Single Episode"
    : `${totalEpisodesCount} episode${totalEpisodesCount === 1 ? "" : "s"}`;

  // Builds the /watch URL for a given episode. Factored out so the big Play/Resume
  // CTA and every episode card (compact/detailed) share one source of truth.
  function buildWatchHref(epNumber: number, seasonNumber: number, rawEpisodeId?: string) {
    const cleanSlug = rawEpisodeId
      ? rawEpisodeId.includes("/")
        ? rawEpisodeId.split("/").pop()
        : rawEpisodeId
      : String(epNumber);
    const isTmdbMedia = !!resolvedTmdb;
    const isTmdbSeries = resolvedTmdb?.mediaType === "tv";
    // Fix B: a TMDB result flagged Animation and successfully matched to an
    // AniList id takes over routing here — it plays through the native
    // anime pipeline (port 3000 service) instead of the generic TMDB one,
    // so `type` is deliberately left unset in that case.
    const isAnimeOverride = isTmdbMedia && !!resolvedAnilistId;
    const streamId = isAnimeOverride ? resolvedAnilistId : resolvedTmdb ? resolvedTmdb.tmdbId : id;
    let providerName = rawEpisodeId?.includes("watch/") ? rawEpisodeId.split("/")[1] : resolvedProvider || "gogoanime";
    if (isTmdbMedia && !isAnimeOverride) providerName = "dahmermovies";
    const streamType = isTmdbMedia && !isAnimeOverride ? (isTmdbSeries ? "tv" : "movie") : undefined;
    const streamQuery = new URLSearchParams({
      provider: providerName,
      // Keep detail-page episode links identical to the URLs generated by
      // /watch's own episode picker. The player still accepts `anilistId`
      // for old history entries, but new navigation must use the canonical
      // `id` key so an anime opened from search carries its actual AniList id
      // into the watch route.
      id: String(streamId),
      category: "sub",
      slug: cleanSlug || "",
      epNum: String(epNumber),
    });
    if (streamType) {
      streamQuery.set("type", streamType);
      if (isTmdbSeries) streamQuery.set("season", String(seasonNumber));
    }
    return `/watch?${streamQuery.toString()}`;
  }

  // The season episode-progress belongs to: TMDB titles track real season numbers,
  // everything else (gogoanime-backed anime) is treated as a single season 1.
  const progressSeasonNumber = resolvedTmdb ? selectedSeason : 1;

  // Figure out what "Play" should mean right now: resume an in-progress episode,
  // jump to the next unwatched one, or start from episode 1 if nothing was watched.
  const lastWatched = progressMap.lastWatched;
  const lastWatchedEntry = lastWatched ? progressMap[progressKey(lastWatched.season, lastWatched.episode)] : undefined;

  let continueTarget: { season: number; episode: number; percent: number; resumeSeconds?: number } | null = null;
  if (lastWatched) {
    if (lastWatchedEntry && lastWatchedEntry.percent < CONTINUE_WATCHING_THRESHOLD) {
      continueTarget = {
        season: lastWatched.season,
        episode: lastWatched.episode,
        percent: lastWatchedEntry.percent,
        resumeSeconds: lastWatchedEntry.positionSeconds,
      };
    } else {
      continueTarget = { season: lastWatched.season, episode: lastWatched.episode + 1, percent: 0 };
    }
  }

  const playTargetSeason = continueTarget?.season ?? seasons[0]?.number ?? selectedSeason;
  const playTargetEpisode = continueTarget?.episode ?? 1;
  // buildWatchHref needs the *real* episode id/slug to route correctly (the
  // same value every episode card below passes as its third argument) —
  // without it, cleanSlug falls back to the bare episode number, which is
  // not a valid slug for the anime/TMDB streaming pipelines and is the
  // reason Play/Resume was landing on a broken /watch URL after a TMDB →
  // AniList conversion.
  const playTargetEpisodeData = episodes.find((ep) => ep.number === playTargetEpisode);
  const playHref = buildWatchHref(playTargetEpisode, playTargetSeason, playTargetEpisodeData?.id);
  const resumeLabel = formatResumeTime(continueTarget?.resumeSeconds);
  const heroYoutubeId = info.trailerUrl?.match(/[?&]v=([^&]+)/)?.[1];

  return (
    <main className="min-h-screen w-full max-w-full bg-[#0a0806] text-neutral-100 font-sans antialiased pb-24 selection:bg-orange-500 selection:text-white overflow-x-clip pt-16">
      <style jsx global>{`
        /* Mobile / iPad polish -----------------------------------------
           - kills the gray tap-flash on Android/iOS Chrome + Safari
           - touch-action: manipulation removes the ~300ms double-tap
             delay on interactive elements so taps register instantly
           - user-select/touch-callout disabled app-wide so nothing
             (text, images, cards) can be selected or long-press-copied
           - -webkit-overflow-scrolling + overscroll-behavior make the
             horizontal rails and nested scroll panes track the finger
             properly on iPad instead of feeling sticky/laggy */
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
          -khtml-user-drag: none;
          -moz-user-drag: none;
        }
        html, body {
          -webkit-overflow-scrolling: touch;
        }
        .overflow-x-auto, .overflow-y-auto {
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          border-radius: 9999px;
        }
        @media (min-width: 768px) and (max-width: 1024px) {
          /* iPad portrait/landscape band: give scroll rails a bit more
             breathing room so drag gestures land on content, not gaps */
          .overflow-x-auto {
            scroll-padding-left: 1rem;
          }
        }
      `}</style>
      {/* GLOBAL PERSISTENT NAVIGATION HEADER */}
      <TopBar
        navItems={[
          { key: "home", label: "Home", href: "/" },
          { key: "upcoming", label: "Upcoming", href: "/?feed=upcoming" },
          { key: "recommendations", label: "Recommendations", href: "/?feed=recommendations" },
          { key: "popular", label: "Popular", href: "/?feed=popular" },
        ]}
        searchMode="modal"
        searchPlaceholder="Search titles, genres..."
        onSearchTrigger={() => setSearchOpen(true)}
      />

      {/* GLOBAL SEARCH OVERLAY */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-start justify-center px-4 pt-20 sm:pt-28"
          onClick={() => setSearchOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-[#0f0d0a] border border-neutral-800 rounded-xl shadow-2xl overflow-hidden max-h-[70vh] flex flex-col"
          >
            <div className="relative border-b border-neutral-900 shrink-0">
              <img
                src="/Assets/search-icon.png"
                alt=""
                className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-70 absolute left-4 top-1/2 -translate-y-1/2"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search anime, movies, TV shows..."
                className="w-full pl-11 pr-11 py-4 bg-transparent text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-neutral-500 hover:text-neutral-200 hover:bg-neutral-900 transition"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-6">
              {searchLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {!searchLoading && searchQuery.trim() === "" && (
                <p className="text-center text-xs text-neutral-600 py-8">Start typing to search across everything.</p>
              )}

              {!searchLoading &&
                searchQuery.trim() !== "" &&
                searchResults.anime.length === 0 &&
                searchResults.movies.length === 0 &&
                searchResults.tv.length === 0 && (
                  <p className="text-center text-xs text-neutral-600 py-8">No results for &ldquo;{searchQuery}&rdquo;.</p>
                )}

              {(
                [
                  { label: "Anime", items: searchResults.anime },
                  { label: "Movies", items: searchResults.movies },
                  { label: "TV Shows", items: searchResults.tv },
                ] as const
              ).map(
                (group) =>
                  group.items.length > 0 && (
                    <div key={group.label} className="space-y-2">
                      <div className="text-[10px] font-mono tracking-widest uppercase text-neutral-600">{group.label}</div>
                      <div className="grid grid-cols-1 gap-1">
                        {group.items.map((item) => (
                          <Link
                            key={`${group.label}-${item.id}`}
                            href={`/anime/${item.id}`}
                            onClick={() => setSearchOpen(false)}
                            className="flex items-center gap-3 p-2 rounded-lg hover:bg-neutral-900 transition group"
                          >
                            <div className="w-9 h-12 rounded overflow-hidden bg-neutral-900 shrink-0">
                              <img src={item.poster || fallbackGlobalImage} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm text-neutral-200 group-hover:text-orange-500 transition truncate">{item.title}</div>
                              {item.meta && <div className="text-[11px] text-neutral-600">{item.meta}</div>}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )
              )}
            </div>
          </div>
        </div>
      )}

      {/* TRAILER MODAL — plays inline with full YouTube controls and sound;
          the page underneath never gets navigated away from. */}
      {trailerModalOpen && info.trailerUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setTrailerModalOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-4xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-neutral-200 truncate pr-4">
                {info.title?.english || info.title?.romaji} — Trailer
              </span>
              <button
                type="button"
                onClick={() => setTrailerModalOpen(false)}
                aria-label="Close trailer"
                className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800 transition shrink-0"
              >
                ✕
              </button>
            </div>
            <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black shadow-2xl">
              <iframe
                src={`https://www.youtube.com/embed/${
                  info.trailerUrl.match(/[?&]v=([^&]+)/)?.[1]
                }?autoplay=1&controls=1&modestbranding=1&rel=0`}
                title="Trailer"
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}

      {/* HERO BACKDROP — fixed px heights per breakpoint so iOS/iPadOS's unstable
          100vh (address-bar show/hide) can't throw off the overlap math below.
          Poster does a slow Ken Burns zoom on load, then fades into an
          autoplaying trailer once it's had a moment to buffer. It starts muted
          (required for autoplay) but exposes YouTube's native control bar so
          people can unmute, pause, or seek — the gradient/particle overlays are
          pointer-events-none so clicks reach the video underneath. */}
      <div className="relative w-full h-[300px] sm:h-[380px] md:h-[440px] lg:h-[500px] bg-black overflow-hidden">
        <img
          src={info.coverImage?.extraLarge || info.coverImage?.large}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover object-top sa-kenburns transition-opacity duration-1000 ${
            heroVideoReady && heroYoutubeId ? "opacity-0" : "opacity-100"
          }`}
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        {heroYoutubeId && (
          <iframe
            key={heroYoutubeId}
            src={`https://www.youtube.com/embed/${heroYoutubeId}?autoplay=1&mute=1&loop=1&controls=1&modestbranding=1&playsinline=1&rel=0&playlist=${heroYoutubeId}`}
            title="Trailer preview"
            allow="autoplay; encrypted-media"
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[178%] h-[178%] sm:w-[130%] sm:h-[130%] border-0 transition-opacity duration-1000 ${
              heroVideoReady ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setHeroVideoReady(true)}
          />
        )}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(14)].map((_, i) => (
            <span
              key={i}
              className="sa-particle absolute rounded-full bg-orange-400/40"
              style={{
                left: `${(i * 137) % 100}%`,
                width: `${2 + (i % 3)}px`,
                height: `${2 + (i % 3)}px`,
                animationDelay: `${(i % 7) * 0.9}s`,
                animationDuration: `${9 + (i % 5) * 1.4}s`,
              }}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0806] via-[#0a0806]/70 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0806] via-transparent to-black/30 pointer-events-none" />
      </div>

      <style>{`
        @keyframes sa-kenburns {
          0% { transform: scale(1); }
          100% { transform: scale(1.08); }
        }
        .sa-kenburns { animation: sa-kenburns 10s ease-out forwards; }
        @keyframes sa-float {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          10% { opacity: 0.7; }
          90% { opacity: 0.5; }
          100% { transform: translateY(-160px) translateX(12px); opacity: 0; }
        }
        .sa-particle { bottom: 0; animation-name: sa-float; animation-timing-function: ease-in; animation-iteration-count: infinite; }
      `}</style>

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-12 -mt-[210px] sm:-mt-[260px] md:-mt-[300px] lg:-mt-[340px] relative z-10 space-y-12 md:space-y-14">
        <div>
          <Link href="/" className="inline-flex items-center space-x-2 text-[10px] font-mono tracking-wider text-neutral-400 hover:text-orange-500 uppercase transition">
            <span>← Back to Browse</span>
          </Link>
        </div>

        {/* TITLE / META / ACTIONS BLOCK */}
        <div className="max-w-3xl space-y-5">
          <h1 className="text-3xl sm:text-4xl md:text-6xl font-black tracking-tight text-white leading-[0.95] uppercase drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)] break-words">
            {info.title?.english || info.title?.romaji || "Untitled"}
          </h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            {info.ageRating && (
              <span
                className="font-bold text-xs px-2 py-0.5 rounded shrink-0"
                style={{ backgroundColor: "rgba(255,255,255,0.92)", color: "#000" }}
              >
                {info.ageRating}
              </span>
            )}
            {info.year && <span className="text-neutral-300 font-medium shrink-0">{info.year}</span>}
            {info.runtime && <span className="text-neutral-300 font-medium shrink-0">{info.runtime}</span>}
            {info.genres && info.genres.length > 0 && (
              <span className="text-neutral-300 font-medium">{info.genres.join(", ")}</span>
            )}
          </div>

          {hasAnyScore && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {info.scores?.imdb && (
                <span className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="font-black text-[10px] px-1.5 py-0.5 rounded leading-none"
                    style={{ backgroundColor: "#f5c518", color: "#000" }}
                  >
                    IMDb
                  </span>
                  <span className="text-neutral-200 font-semibold">{info.scores.imdb}</span>
                </span>
              )}
              {info.scores?.rt && (
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="text-base leading-none" aria-hidden>🍿</span>
                  <span className="text-neutral-200 font-semibold">{info.scores.rt}</span>
                </span>
              )}
              {info.scores?.tmdb && (
                <span className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="font-black text-[10px] px-1.5 py-0.5 rounded leading-none"
                    style={{ backgroundColor: "#01d277", color: "#000" }}
                  >
                    TMDB
                  </span>
                  <span className="text-neutral-200 font-semibold">{info.scores.tmdb}</span>
                </span>
              )}
            </div>
          )}

          {/* PRIMARY PLAY / CONTINUE WATCHING CTA — impossible to miss, sits before
              every secondary action so starting playback is always one click. */}
          <Link
            href={playHref}
            className="group inline-flex items-center gap-3 bg-white hover:bg-neutral-200 text-black font-bold rounded-lg pl-4 pr-6 py-3 transition w-fit shadow-lg shadow-black/40"
          >
            <span className="w-8 h-8 rounded-full bg-black flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
            </span>
            <span className="text-left leading-tight">
              {continueTarget ? (
                <>
                  <span className="block text-[10px] font-mono uppercase tracking-widest text-neutral-600">
                    Continue Watching
                  </span>
                  <span className="block text-sm">
                    {isMovieTitle ? (
                      "Movie"
                    ) : seasons.length > 1 ? (
                      `S${continueTarget.season} `
                    ) : (
                      ""
                    )}
                    {!isMovieTitle && `Episode ${continueTarget.episode}`}
                    {resumeLabel ? ` · Resume at ${resumeLabel}` : ""}
                  </span>
                </>
              ) : (
                <span className="block text-sm">{playButtonLabel}</span>
              )}
            </span>
          </Link>

          {/* ACTION BUTTONS */}
          <div className="flex items-start gap-4 sm:gap-6 pt-1">
            <button onClick={() => setIsBookmarked((v) => !v)} className="flex flex-col items-center gap-1.5 group w-16 shrink-0">
              <span className={`w-11 h-11 rounded-full flex items-center justify-center border transition ${isBookmarked ? "bg-orange-500 border-orange-500" : "bg-white/10 border-white/20 group-hover:bg-white/20"}`}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill={isBookmarked ? "white" : "none"} stroke="white" strokeWidth="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-[10.5px] text-neutral-300 font-medium text-center leading-tight">
                {isBookmarked ? "On Watchlist" : (<>Add to<br />Watchlist</>)}
              </span>
            </button>

            <button onClick={handleTrailer} className="flex flex-col items-center gap-1.5 group w-16 shrink-0">
              <span className="w-11 h-11 rounded-full flex items-center justify-center border bg-white/10 border-white/20 group-hover:bg-white/20 transition">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <circle cx="12" cy="12" r="10" fill="none" stroke="white" strokeWidth="2" />
                  <path d="M10 8l6 4-6 4z" />
                </svg>
              </span>
              <span className="text-[10.5px] text-neutral-300 font-medium text-center leading-tight">Watch Trailer</span>
            </button>

            <button onClick={() => setIsWatched((v) => !v)} className="flex flex-col items-center gap-1.5 group w-16 shrink-0">
              <span className={`w-11 h-11 rounded-full flex items-center justify-center border transition ${isWatched ? "bg-orange-500 border-orange-500" : "bg-white/10 border-white/20 group-hover:bg-white/20"}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-[10.5px] text-neutral-300 font-medium text-center leading-tight">
                {isWatched ? "Watched" : (<>Mark as<br />Watched</>)}
              </span>
            </button>

            <button onClick={handleShare} className="flex flex-col items-center gap-1.5 group w-16 shrink-0">
              <span className="w-11 h-11 rounded-full flex items-center justify-center border bg-white/10 border-white/20 group-hover:bg-white/20 transition">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-[10.5px] text-neutral-300 font-medium text-center leading-tight">Share This<br />Show</span>
            </button>
          </div>

          <p className="text-neutral-300 text-sm leading-relaxed max-w-2xl pt-1">{cleanDescription(info.description)}</p>
        </div>

        {/* SEASONS PICKER */}
        {showSeasonPicker && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">{seasons.length} Seasons</h2>
            <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-neutral-800 snap-x snap-mandatory scroll-smooth">
              {seasons.map((season) => {
                const active = season.number === selectedSeason;
                return (
                  <button
                    key={season.number}
                    onClick={() => handleSelectSeason(season.number)}
                    className="shrink-0 w-28 sm:w-32 md:w-36 text-left group focus:outline-none snap-start"
                  >
                    <div
                      className={`relative aspect-[2/3] rounded-lg overflow-hidden border-2 transition-all duration-200 ${
                        active ? "border-orange-500 shadow-[0_0_0_3px_rgba(249,115,22,0.25)]" : "border-transparent group-hover:border-neutral-600"
                      }`}
                    >
                      <img
                        src={season.poster || fallbackGlobalImage}
                        alt={season.name}
                        className={`w-full h-full object-cover transition duration-300 ${active ? "" : "opacity-70 group-hover:opacity-100"}`}
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                      <div className="absolute bottom-2 left-2 right-2">
                        <div className={`text-[11px] font-bold leading-tight ${active ? "text-orange-400" : "text-white"}`}>
                          {season.name}
                        </div>
                        {season.episodeCount ? (
                          <div className="text-[10px] text-neutral-300">{season.episodeCount} episodes</div>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* EPISODE CATALOG */}
        <div className="space-y-6 pt-2">
          <div className="border-b border-neutral-900 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm md:text-base font-bold uppercase tracking-widest text-neutral-200">
                {catalogLabel}
              </h2>
              <div className="text-[11px] font-mono text-neutral-600">
                {seasonLoading ? "Loading episodes…" : episodeCountLabel}
              </div>
            </div>

            <div className="flex items-center bg-neutral-900 border border-neutral-800 p-1 rounded space-x-1 self-start sm:self-auto">
              {(["compact", "detailed"] as ViewStyle[]).map((style) => (
                <button
                  key={style}
                  onClick={() => setViewStyle(style)}
                  className={`px-3 py-1.5 rounded text-[10px] font-mono tracking-tight capitalize transition ${
                    viewStyle === style ? "bg-orange-500 text-white font-bold shadow" : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-8 items-start">
            {chunkRanges.length > 0 && (
              <div className="w-full lg:w-48 shrink-0 flex lg:flex-col flex-wrap gap-1 bg-neutral-900/30 border border-neutral-900 p-2 rounded">
                <div className="text-[9px] font-mono tracking-wider text-neutral-600 uppercase p-2 hidden lg:block border-b border-neutral-900 mb-1">
                  Episode Ranges
                </div>
                {chunkRanges.map((range, index) => (
                  <button
                    key={range.label}
                    onClick={() => setActiveRangeIndex(index)}
                    className={`flex-1 lg:flex-initial text-left px-3 py-2 rounded text-[11px] font-mono transition-all duration-200 border ${
                      index === activeRangeIndex
                        ? "bg-orange-500/10 border-orange-500/30 text-orange-500 font-bold"
                        : "bg-transparent border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-900/50"
                    }`}
                  >
                    Episodes {range.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 w-full min-w-0">
              {seasonLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : currentDisplayedEpisodes.length > 0 ? (
                <div
                  className={
                    viewStyle === "compact"
  ? "grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-3"
  : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-x-6 gap-y-8"
                  }
                >
                  {currentDisplayedEpisodes.map((ep) => {
                    const watchHref = buildWatchHref(ep.number, selectedSeason, ep.id);
                    const fallbackDescription = "No synopsis has been published for this episode yet.";
                    const thumb = ep.image || info.coverImage?.large || fallbackGlobalImage;

                    const epPercent = progressMap[progressKey(progressSeasonNumber, ep.number)]?.percent ?? 0;
                    const epWatched = epPercent >= CONTINUE_WATCHING_THRESHOLD;
                    const epDuration = ep.runtimeMinutes ? `${ep.runtimeMinutes}m` : info.runtime;

                    const ProgressBar = epPercent > 0 ? (
                      <div className="h-[3px] w-full bg-white/15 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500" style={{ width: `${Math.min(epPercent, 100)}%` }} />
                      </div>
                    ) : null;

                    const WatchedBadge = epWatched ? (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center shadow">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    ) : null;

                    // COMPACT: numbered thumbnail tile
                    if (viewStyle === "compact") {
                      return (
                        <Link
                          key={ep.id}
                          href={watchHref}
                          className="relative aspect-video rounded-lg overflow-hidden border border-neutral-900 hover:border-orange-500/60 transition-all duration-300 block group outline-none focus:border-orange-500 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40"
                        >
                          <img
                            src={thumb}
                            alt={`Episode ${ep.number}`}
                            className="w-full h-full object-cover transition duration-300 group-hover:scale-110 group-hover:brightness-110 opacity-80 group-hover:opacity-100"
                            loading="lazy"
                            decoding="async"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                            <div className="w-8 h-8 rounded-full bg-orange-500/90 flex items-center justify-center">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                            </div>
                          </div>
                          {WatchedBadge}
                          <div className="absolute bottom-1.5 left-2 right-2 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-white font-bold text-xs drop-shadow">EP {ep.number}</span>
                              {ep.rating && (
                                <span className="text-[9px] text-neutral-200 opacity-0 group-hover:opacity-100 transition">
                                  ★ {ep.rating.toFixed(1)}
                                </span>
                              )}
                            </div>
                            {ProgressBar}
                          </div>
                          {ep.title && (
                            <div className="absolute top-1.5 left-2 right-8 text-[10px] text-neutral-200 font-medium truncate opacity-0 group-hover:opacity-100 transition">
                              {ep.title}
                            </div>
                          )}
                        </Link>
                      );
                    }

                    // DETAILED (primary layout): borderless thumbnail, corner episode
                    // badge, bold title + gray synopsis below — modeled on Plex's
                    // clean, minimal episode-row treatment.
                    return (
                      <Link key={ep.id} href={watchHref} className="block group outline-none">
                        <div className="relative aspect-video rounded-lg overflow-hidden bg-neutral-900 ring-1 ring-white/5 group-hover:ring-orange-500/50 group-focus:ring-orange-500/60 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-black/50">
                          <img
                            src={thumb}
                            alt={`Episode ${ep.number}`}
                            className="w-full h-full object-cover transition duration-500 group-hover:scale-110 group-hover:brightness-110"
                            loading="lazy"
                            decoding="async"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                            <div className="w-9 h-9 rounded-full bg-orange-500/90 flex items-center justify-center">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                            </div>
                          </div>
                          <div className="absolute top-2 right-2 bg-black/75 text-white font-bold text-[10px] px-1.5 py-0.5 rounded">
                            E{ep.number}
                          </div>
                          {epDuration && (
                            <div className="absolute bottom-2 right-2 bg-black/70 text-neutral-200 text-[9px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition">
                              {epDuration}
                            </div>
                          )}
                          {WatchedBadge}
                          {ProgressBar && <div className="absolute bottom-0 left-0 right-0">{ProgressBar}</div>}
                        </div>
                        <div className="pt-2.5 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-neutral-100 group-hover:text-orange-500 font-bold text-[13px] transition duration-200 truncate">
                              {ep.title || `Episode ${ep.number}`}
                            </h3>
                            {ep.rating && (
                              <span className="text-[10px] text-neutral-500 shrink-0">★ {ep.rating.toFixed(1)}</span>
                            )}
                          </div>
                          <p className="text-[11.5px] text-neutral-400 line-clamp-2 leading-relaxed">
                            {ep.description ? cleanDescription(ep.description) : fallbackDescription}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-neutral-900/10 border border-neutral-900/60 rounded-lg p-12 text-center max-w-sm mx-auto space-y-1">
                  <p className="text-neutral-500 font-semibold text-xs">No episodes found</p>
                  <p className="text-[11px] text-neutral-600 leading-normal">
                    This title has no tracked episodes for this season yet.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CAST */}
        {cast.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">Cast</h2>
            <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-neutral-800 snap-x snap-mandatory scroll-smooth">
              {cast.map((member) => (
                <div key={member.id} className="shrink-0 w-24 text-center space-y-2 snap-start">
                  <div className="w-24 h-24 rounded-full overflow-hidden bg-neutral-900 border border-neutral-800 mx-auto">
                    <img
                      src={member.profile || fallbackGlobalImage}
                      alt={member.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div className="text-[11px] font-semibold text-neutral-200 leading-tight truncate">{member.name}</div>
                  {member.character && (
                    <div className="text-[10px] text-neutral-500 leading-tight truncate">{member.character}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MORE LIKE THIS */}
        {related.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">More Like This</h2>
            <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-neutral-800 snap-x snap-mandatory scroll-smooth">
              {related.map((item) => (
                <Link
                  key={item.id}
                  href={`/anime/tmdb-${item.mediaType}-${item.id}`}
                  className="shrink-0 w-28 sm:w-32 group snap-start"
                >
                  <div className="relative aspect-[2/3] rounded-lg overflow-hidden border border-transparent group-hover:border-orange-500/60 transition-all duration-300 group-hover:-translate-y-1">
                    <img
                      src={item.poster || fallbackGlobalImage}
                      alt={item.title}
                      className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                    {item.rating && (
                      <div className="absolute top-1.5 right-1.5 bg-black/70 text-[9px] font-mono text-orange-400 px-1.5 py-0.5 rounded">
                        ★ {item.rating}
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-300 group-hover:text-orange-500 font-medium mt-1.5 truncate transition">
                    {item.title}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* REVIEWS */}
        {reviews.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">Reviews</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {reviews.map((review) => (
                <div key={review.id} className="bg-neutral-900/40 border border-neutral-900 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-neutral-200">{review.author}</span>
                    {review.rating && (
                      <span className="text-[10px] font-mono text-orange-400">★ {review.rating}/10</span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-relaxed line-clamp-4">{review.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STUDIOS / NETWORKS */}
        {companies.length > 0 && (
          <div className="space-y-4 pb-4">
            <h2 className="text-lg font-bold text-white">Studios &amp; Networks</h2>
            <div className="flex flex-wrap items-center gap-6">
              {companies.map((company) =>
                company.logo ? (
                  <img
                    key={company.id}
                    src={company.logo}
                    alt={company.name}
                    title={company.name}
                    className="h-6 sm:h-7 object-contain opacity-70 hover:opacity-100 transition invert-0 brightness-0 invert"
                  />
                ) : (
                  <span key={company.id} className="text-xs font-mono text-neutral-500">
                    {company.name}
                  </span>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

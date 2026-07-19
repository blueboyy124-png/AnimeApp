"use client";

import { useState, useEffect, useRef, ChangeEvent } from "react";
import Link from "next/link";
import ProfileGate, { useProfile } from "./profilegate";
import { getApiBaseUrl, getTmdbEmbedApiUrl } from "./utils/api";
import { filterForKids } from "./utils/contentFilter";

interface AnimeCard {
  id: string | number;
  title?: any; 
  name?: string;
  coverImage?: string; 
  image?: string;
  poster?: string;
  cover?: string;
  poster_path?: string;
  backdrop_path?: string;
  bannerImage?: string;
  description?: string;
  overview?: string;
  genres?: string[];
  type?: string; 
  format?: string;
  media_type?: string;
  genre_ids?: number[];
  original_language?: string;
}

interface WatchHistoryItem {
  anilistId: string;
  animeTitle: string;
  episodeNumber: string;
  episodeImage: string;
  currentTime: number;
  duration: number;
  progressPercent: number;
  provider: string;
  category: string;
  slug: string;
  updatedAt: number;
}

type FeedCategory = "trending" | "upcoming" | "recommendations" | "popular";

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
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [recommendationHeadline, setRecommendationHeadline] = useState<string>("Picks For You");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const feedCacheRef = useRef<Record<string, FeedCacheEntry>>({});
  const feedRequestIdRef = useRef(0);
  const feedCacheHydratedRef = useRef(false);
  const searchCacheRef = useRef<Record<string, AnimeCard[]>>({});
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const API_BASE = getApiBaseUrl();
  const TMDB_EMBED_API = getTmdbEmbedApiUrl();
  const RESULTS_PER_PAGE = 20;

  useEffect(() => {
    const cache = loadFeedCache();
    const cachedHero = cache["_hero"];
    if (cachedHero) {
      // Instant paint from whatever we last saw — this is what kills the
      // black-flash-then-pop-in on every homepage visit.
      setTrending(cachedHero.results);
    }

    fetch(`${API_BASE}/trending`)
      .then((res) => res.json())
      .then((data) => {
        let results: AnimeCard[] = [];
        if (data && data.results && Array.isArray(data.results.results)) {
          results = data.results.results;
        } else if (data && Array.isArray(data.results)) {
          results = data.results;
        }

        if (!cachedHero || !sameResultIds(cachedHero.results, results)) {
          setTrending(results);
        }

        cache["_hero"] = { results };
        saveFeedCache(cache);
      })
      .catch((err) => console.error("Error fetching trending spotlight banner:", err));
  }, [API_BASE]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileMenuOpen]);

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
      // Cold start, no cached recommendations yet — recommendations can
      // take a moment to compute server-side, so show trending (which is
      // already loaded for the hero anyway) as an instant placeholder
      // instead of a blank spinner. Swapped for the real thing the
      // moment it arrives below.
      setCurrentFeed(trending);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let targetUrl = `${API_BASE}/${activeCategory}`;
    if (activeCategory === "recommendations" && currentProfile) {
      targetUrl = `${API_BASE}/recommendations?profileId=${currentProfile.id}`;
    }

    fetch(targetUrl)
      .then((res) => res.json())
      .then((data) => {
        // A newer tab switch or profile change already superseded this
        // request — drop the result instead of clobbering fresher state.
        if (requestId !== feedRequestIdRef.current) return;

        let results: AnimeCard[] = [];
        if (data && data.results && Array.isArray(data.results.results)) {
          results = data.results.results;
        } else if (data && Array.isArray(data.results)) {
          results = data.results;
        } else if (data && Array.isArray(data)) {
          results = data;
        }

        const headline = activeCategory === "recommendations" ? data?.headline : undefined;

        // Only touch state (and trigger a re-render) if the data actually
        // changed from what's already painted — silent no-op otherwise,
        // which is what makes repeat tab switches feel instant instead of
        // re-flashing the same content.
        if (!cached || !sameResultIds(cached.results, results)) {
          setCurrentFeed(results);
          if (headline) setRecommendationHeadline(headline);
        }

        feedCacheRef.current[cacheKey] = { results, headline };
        saveFeedCache(feedCacheRef.current);
        setLoading(false);
      })
      .catch((err) => {
        console.error(`Error loading category: ${activeCategory}`, err);
        if (!cached) {
          setCurrentFeed([]);
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, API_BASE, currentProfile]);

  useEffect(() => {
    if (!currentProfile) return;
    try {
      const storedHistory = localStorage.getItem(`streamanime_watch_history_${currentProfile.id}`);
      if (storedHistory) {
        const parsedHistory: WatchHistoryItem[] = JSON.parse(storedHistory);
        parsedHistory.sort((a, b) => b.updatedAt - a.updatedAt);
        
        const seenAnimeIds = new Set<string>();
        const uniqueSeriesHistory = parsedHistory.filter((item) => {
          if (seenAnimeIds.has(item.anilistId)) {
            return false;
          }
          seenAnimeIds.add(item.anilistId);
          return true;
        });

        setWatchHistory(uniqueSeriesHistory);
      } else {
        setWatchHistory([]);
      }
    } catch (e) {
      console.error("Failed executing client tracking history sync routine:", e);
    }
  }, [currentProfile]);

  useEffect(() => {
    if (trending.length === 0) return;
    const limit = Math.min(trending.length, 5);
    const interval = setInterval(() => {
      setActiveHeroIndex((prevIndex) => (prevIndex + 1) % limit);
    }, 4000);

    return () => clearInterval(interval);
  }, [trending]);

  const performSearchFetch = async (query: string, targetPage: number, appendMode: boolean) => {
    if (!query.trim()) return;
    const requestId = ++searchRequestIdRef.current;
    const cacheKey = `${query.trim().toLowerCase()}:${targetPage}`;

    // Don't show a loading spinner if we already painted cached results for
    // this exact query synchronously in handleSearchChange — only the very
    // first time a term is searched needs a visible loading state.
    if (!appendMode && !searchCacheRef.current[cacheKey]) setSearchingLoading(true);

    try {
      // Anime has its own API and intentionally remains first in the merged
      // list. Movie/TV metadata comes from the TMDB Embed API, never the
      // anime server's provider index.
      const animeUrl = `${API_BASE}/search?query=${encodeURIComponent(query)}&page=${targetPage}&per_page=${RESULTS_PER_PAGE}`;
      const tvMovieUrl = `${TMDB_EMBED_API}/api/search?query=${encodeURIComponent(query)}&page=${targetPage}`;

      const [animeRes, tvMovieRes] = await Promise.allSettled([
        fetch(animeUrl).then((r) => r.json()),
        fetch(tvMovieUrl).then((r) => r.json()),
      ]);

      // A newer keystroke already fired a fresher search — drop this
      // response instead of letting a slow, stale request win the race.
      if (requestId !== searchRequestIdRef.current) return;

      const animeResults = animeRes.status === "fulfilled" ? extractResultsArray(animeRes.value) : [];
      const tvMovieResults = tvMovieRes.status === "fulfilled" ? extractResultsArray(tvMovieRes.value) : [];
      const parsedResults = mergeSearchResults(animeResults, tvMovieResults);

      if (appendMode) {
        setSearchResults((prev) => [...prev, ...parsedResults]);
      } else {
        setSearchResults(parsedResults);
        searchCacheRef.current[cacheKey] = parsedResults;
      }

      // "More results" paginates both sources together — stop offering it
      // once neither source is still returning a full page.
      const tmdbHasMore = tvMovieRes.status === "fulfilled" && Number(tvMovieRes.value?.page) < Number(tvMovieRes.value?.totalPages);
      setHasMoreResults(animeResults.length >= RESULTS_PER_PAGE || tmdbHasMore);
    } catch (err) {
      console.error("Local search query exception track dropped:", err);
      if (!appendMode) setSearchResults([]);
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
    const cached = searchCacheRef.current[`${trimmed.toLowerCase()}:1`];
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

  const formatSecondsToLabel = (seconds: number) => {
    if (isNaN(seconds) || seconds <= 0) return "0:00";
    const totalSeconds = Math.round(seconds);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isSearching = searchQuery.trim().length > 2;
  const isKids = currentProfile?.is_kids || false;
  const standardShowcaseList = filterForKids(isSearching ? searchResults : currentFeed, isKids);
  const topFiveTrending = filterForKids(trending, isKids).slice(0, 5);

  const cleanDescription = (htmlStr?: string) => {
    if (!htmlStr) return "Stream instantly in high definition.";
    return htmlStr.replace(/<\/?[^>]+(>|$)/g, "").substring(0, 140) + "...";
  };

  const getHeaderTitle = () => {
    if (isSearching) return `Search Results: "${searchQuery}"`;
    if (activeCategory === "trending") return "Trending";
    if (activeCategory === "upcoming") return "Upcoming Releases";
    if (activeCategory === "recommendations") return recommendationHeadline;
    if (activeCategory === "popular") return "Popular Trends";
    return "Media Feed";
  };

  const getDisplayTitle = (anime: AnimeCard) => {
    if (typeof anime.title === "string") return anime.title;
    if (anime.title && typeof anime.title === "object") {
      return anime.title.english || anime.title.romaji || anime.title.userPreferred || "Untitled Show";
    }
    return anime.name || anime.title || "Untitled Show";
  };

  const getDisplayCover = (anime: AnimeCard) => {
    // 1. Check nested AniList structural definitions
    if (anime.coverImage && typeof anime.coverImage === "object") {
      const imgObj = anime.coverImage as any;
      if (imgObj.extraLarge) return imgObj.extraLarge;
      if (imgObj.large) return imgObj.large;
      if (imgObj.medium) return imgObj.medium;
    }

    // 2. Scan fallback properties sequentially to extract image assets
    const potentialPaths = [
      anime.coverImage,
      anime.image,
      anime.poster,
      anime.cover,
      anime.poster_path,
      anime.backdrop_path,
      anime.bannerImage
    ];

    for (const path of potentialPaths) {
      if (typeof path === "string" && path.trim().length > 0) {
        const cleanPath = path.trim();
        
        // INTERCEPT CRITERIA: Catches text placeholders & Amazon's raw question-mark asset templates
        if (
          cleanPath.toLowerCase() === "n/a" || 
          cleanPath === "?" || 
          cleanPath.includes("placeholder") || 
          cleanPath.includes("placehold.co") ||
          cleanPath.includes("nopicture") ||
          cleanPath.includes("no-cover") ||
          cleanPath.includes("CR0,0,380,562") // Intercepts the default IMDb question mark cover returned in your JSON
        ) {
          continue;
        }
        
        if (cleanPath.startsWith("/")) {
          return `https://image.tmdb.org/t/p/w500${cleanPath}`;
        }
        return cleanPath;
      }
    }

    // 3. High-quality visual fallback background (No broken layouts or question marks)
    return "https://images.unsplash.com/photo-1574375927938-d5a98e8edd86?q=80&w=500&auto=format&fit=crop";
  };

  const getDetailsHref = (anime: AnimeCard) => {
  // TMDB movie/TV results carry fields AniList anime entries never have.
  // Use that to tell the two sources apart instead of guessing from type/format.
  const isTmdbSource =
    anime.media_type !== undefined ||
    anime.poster_path !== undefined ||
    anime.backdrop_path !== undefined ||
    anime.genre_ids !== undefined ||
    anime.original_language !== undefined;

  if (isTmdbSource) {
    const mediaType = String(anime.media_type || anime.type || anime.format || "").toLowerCase();

    // Checks if the scraper flagged this index item as a TV series collection
    if (mediaType === "tv" || mediaType === "series") {
      return `/anime/tmdb-tv-${anime.id}`;
    }

    // Default routing fallback behavior for feature films
    return `/anime/tmdb-movie-${anime.id}`;
  }

  // Regular AniList anime — plain numeric AniList id, no prefix.
  return `/anime/${anime.id}`;
};

  const isTmdbResult = (item: AnimeCard) =>
    item.media_type === "movie" || item.media_type === "tv";
  const animeSearchResults = standardShowcaseList.filter((item) => !isTmdbResult(item));
  const movieSearchResults = standardShowcaseList.filter((item) => item.media_type === "movie");
  const tvSearchResults = standardShowcaseList.filter((item) => item.media_type === "tv");

  const renderMediaCard = (anime: AnimeCard) => (
    <Link 
      href={getDetailsHref(anime)} 
      key={`${anime.media_type || "anime"}-${anime.id}`} 
      className="group flex flex-col space-y-2 outline-none transition-transform duration-200 ease-out hover:-translate-y-1"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-neutral-900 shadow-md group-hover:shadow-xl group-hover:shadow-black/50 border border-neutral-900 group-hover:border-neutral-700 group-focus:border-orange-500 transition-all duration-200">
        <img 
          src={getDisplayCover(anime)} 
          alt={getDisplayTitle(anime)}
          className="w-full h-full object-cover object-center transition duration-500 ease-out group-hover:scale-103 group-hover:brightness-90"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <div className="bg-orange-500/95 p-2.5 rounded-full scale-90 group-hover:scale-100 transition-transform duration-300 shadow-xl">
            <img src="/Assets/play-button.png" alt="Play" className="w-4 h-4 object-contain brightness-200" />
          </div>
        </div>
      </div>

      <div className="px-0.5 space-y-0.5">
        <h4 className="font-semibold text-xs md:text-sm leading-tight line-clamp-2 text-neutral-300 group-hover:text-orange-500 transition duration-200">
          {getDisplayTitle(anime)}
        </h4>
        <div className="text-[9px] md:text-[10px] font-mono text-neutral-600 tracking-tight font-medium uppercase">
          {anime.media_type === "movie" ? "Movie" : anime.media_type === "tv" ? "TV Show" : "Anime"}
        </div>
      </div>
    </Link>
  );

  return (
    <>
      <main className="relative min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased selection:bg-orange-500 selection:text-white pb-20 overflow-x-hidden">
        {/* Barely-there radial gradient — 3-5% opacity, purely to keep the
            near-black background from reading as completely flat. Fixed so
            it doesn't scroll/repeat awkwardly with page content. */}
        <div
          className="fixed inset-0 pointer-events-none z-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(249,115,22,0.05), transparent 60%)",
          }}
        />
        <style jsx global>{`
          /* Mobile touch polish: kills the gray tap-flash Android/iOS
             Chrome shows on tap, and touch-action: manipulation removes
             the ~300ms double-tap-zoom delay on buttons/links so taps
             register instantly instead of waiting to see if it's a
             double-tap. -webkit-overflow-scrolling gives momentum
             scrolling on iOS Safari instead of the stock choppy scroll. */
          * {
            -webkit-tap-highlight-color: transparent;
          }
          a, button {
            touch-action: manipulation;
          }
          html, body {
            -webkit-overflow-scrolling: touch;
          }
          @keyframes dropdownOpen {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        {needsPasswordSetup && (
          <div className="fixed top-16 inset-x-0 z-40 bg-orange-500 text-black">
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
        <header className="fixed top-0 inset-x-0 h-16 bg-black/80 backdrop-blur-md z-50 flex items-center justify-between px-4 sm:px-6 md:px-12 border-b border-neutral-900/40">
          <div className="flex items-center space-x-4 md:space-x-12 min-w-0">
            <button 
              onClick={() => { setActiveCategory("recommendations"); setSearchQuery(""); }} 
              className="text-xl md:text-2xl font-black tracking-tighter text-orange-500 hover:opacity-90 transition text-left cursor-pointer flex-shrink-0"
            >
              STREAMANIME
            </button>
            
            <nav className="hidden lg:flex items-center space-x-6 xl:space-x-8 text-sm font-medium text-neutral-400 flex-shrink-0">
              <button 
                onClick={() => { setActiveCategory("recommendations"); setSearchQuery(""); }} 
                className={`transition cursor-pointer ${activeCategory === "recommendations" && !isSearching ? "text-neutral-100 font-bold" : "hover:text-neutral-300"}`}
              >
                Home
              </button>
              <button 
                onClick={() => { setActiveCategory("trending"); setSearchQuery(""); }} 
                className={`transition cursor-pointer ${activeCategory === "trending" && !isSearching ? "text-neutral-100 font-bold" : "hover:text-neutral-300"}`}
              >
                Trending
              </button>
              <button 
                onClick={() => { setActiveCategory("upcoming"); setSearchQuery(""); }} 
                className={`transition cursor-pointer ${activeCategory === "upcoming" && !isSearching ? "text-neutral-100 font-bold" : "hover:text-neutral-300"}`}
              >
                Upcoming
              </button>
              <button 
                onClick={() => { setActiveCategory("popular"); setSearchQuery(""); }} 
                className={`transition cursor-pointer ${activeCategory === "popular" && !isSearching ? "text-neutral-100 font-bold" : "hover:text-neutral-300"}`}
              >
                Popular
              </button>
            </nav>
          </div>

          <div className="flex items-center space-x-3 sm:space-x-4 flex-shrink-0 ml-auto">
            <div className="relative max-w-xs w-36 xs:w-40 md:w-48 lg:w-64 focus-within:lg:w-80 hidden sm:block transition-[width] duration-200 ease-out">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <img 
                  src="/Assets/search-icon.png" 
                  alt="Search" 
                  className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90"
                />
              </div>
              <input
                type="text"
                placeholder="Search movies, TV or anime..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="w-full pl-10 pr-4 py-1.5 rounded-md bg-neutral-900/90 border border-neutral-800 text-sm placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:bg-neutral-900 transition duration-200"
              />
            </div>

            {currentProfile && (
              <div className="relative" ref={profileMenuRef}>
                <button
                  onClick={() => setProfileMenuOpen((v) => !v)}
                  className="flex items-center space-x-2 p-1 rounded-md hover:bg-neutral-900 transition focus:outline-none group cursor-pointer"
                  title={currentProfile.name}
                >
                  <div className="w-8 h-8 rounded overflow-hidden border border-neutral-800 group-hover:border-orange-500 transition">
                    <img src={currentProfile.avatar_url} alt={currentProfile.name} className="w-full h-full object-cover bg-neutral-800" />
                  </div>
                  <span className="hidden md:inline text-xs font-semibold text-neutral-400 group-hover:text-neutral-200 transition">
                    {currentProfile.name}
                  </span>
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 mt-2 w-44 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden z-50 animate-[dropdownOpen_150ms_ease-out]">
                    <button
                      onClick={() => { setProfileMenuOpen(false); switchProfile(); }}
                      className="w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
                    >
                      Switch Profile
                    </button>
                    <Link
                      href="/downloads"
                      onClick={() => setProfileMenuOpen(false)}
                      className="block w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
                    >
                      Downloads
                    </Link>
                    <Link
                      href="/settings"
                      onClick={() => setProfileMenuOpen(false)}
                      className="block w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
                    >
                      Settings
                    </Link>
                    <button
                      onClick={() => { setProfileMenuOpen(false); logout(); }}
                      className="w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:bg-red-950/40 hover:text-red-400 transition cursor-pointer border-t border-neutral-800"
                    >
                      Log Out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* MOBILE CATEGORY SELECTOR */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 h-14 bg-neutral-950/95 backdrop-blur-md border-t border-neutral-900/60 z-50 flex items-center justify-around text-[11px] font-medium text-neutral-400 px-2">
          <button 
            onClick={() => { setActiveCategory("recommendations"); setSearchQuery(""); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
            className={`flex flex-col items-center space-y-0.5 ${activeCategory === "recommendations" && !isSearching ? "text-orange-500 font-bold" : ""}`}
          >
            <span>Home</span>
          </button>
          <button 
            onClick={() => { setActiveCategory("trending"); setSearchQuery(""); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
            className={`flex flex-col items-center space-y-0.5 ${activeCategory === "trending" && !isSearching ? "text-orange-500 font-bold" : ""}`}
          >
            <span>Trending</span>
          </button>
          <button 
            onClick={() => { setActiveCategory("upcoming"); setSearchQuery(""); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
            className={`flex flex-col items-center space-y-0.5 ${activeCategory === "upcoming" && !isSearching ? "text-orange-500 font-bold" : ""}`}
          >
            <span>Upcoming</span>
          </button>
          <button 
            onClick={() => { setActiveCategory("popular"); setSearchQuery(""); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
            className={`flex flex-col items-center space-y-0.5 ${activeCategory === "popular" && !isSearching ? "text-orange-500 font-bold" : ""}`}
          >
            <span>Popular</span>
          </button>
        </div>

        {/* SPOTLIGHT BANNER SLIDER */}
        {!isSearching && topFiveTrending.length > 0 && (
          <section className="relative w-full h-[60vh] sm:h-[75vh] md:h-[85vh] bg-black overflow-hidden pt-16">
            <div 
              className="w-full h-full flex transition-transform duration-700 ease-in-out"
              style={{ transform: `translateX(-${activeHeroIndex * 100}%)` }}
            >
              {topFiveTrending.map((show, index) => (
                <div key={show.id} className="relative w-full h-full flex-shrink-0 overflow-hidden">
                  <img 
                    src={show.bannerImage || (show.coverImage && typeof show.coverImage === 'object' ? (show.coverImage.extraLarge || show.coverImage.large) : show.coverImage)} 
                    alt="Spotlight Artwork"
                    className="absolute inset-0 w-full h-full object-cover object-center opacity-35"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/30 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-transparent to-transparent" />

                  <div className="absolute inset-x-0 bottom-0 p-4 sm:p-8 md:p-16 space-y-3 md:space-y-4 z-10 max-w-3xl">
                    <span className="inline-block text-[9px] md:text-[10px] font-bold tracking-widest text-orange-500 uppercase">
                      #{index + 1} Spotlight
                    </span>

                    <h2 className="text-2xl sm:text-4xl md:text-6xl font-black tracking-tight text-white leading-[1.05] drop-shadow-lg line-clamp-2">
                      {getDisplayTitle(show)}
                    </h2>

                    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] md:text-sm font-semibold text-neutral-300">
                      {(show as any).averageScore != null && (
                        <span className="flex items-center gap-1 text-orange-400">
                          <span>★</span>
                          {((show as any).averageScore / 10).toFixed(1)}
                        </span>
                      )}
                      {((show as any).seasonYear || (show as any).year) && (
                        <span>{(show as any).seasonYear || (show as any).year}</span>
                      )}
                      {(show.format || show.type) && (
                        <span className="px-1.5 py-0.5 border border-neutral-500 rounded text-[9px] md:text-[10px] uppercase tracking-wide text-neutral-300">
                          {show.format || show.type}
                        </span>
                      )}
                      {Array.isArray(show.genres) && show.genres.length > 0 && (
                        <span className="text-neutral-400 line-clamp-1">{show.genres.slice(0, 3).join(" • ")}</span>
                      )}
                    </div>

                    <p className="text-[11px] md:text-sm text-neutral-300 max-w-xl line-clamp-2 sm:line-clamp-3 leading-relaxed drop-shadow">
                      {cleanDescription(show.description || show.overview)}
                    </p>

                    <div className="flex items-center space-x-3 pt-1 md:pt-3">
                      <Link 
                        href={`/anime/${show.id}`}
                        className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs md:text-sm px-4 py-2 md:px-6 md:py-3 rounded-md transition-all duration-200 hover:scale-[1.03] flex items-center space-x-2 active:scale-95 shadow-lg shadow-orange-500/20"
                      >
                        <img src="/Assets/play-button.png" alt="" className="w-3.5 h-3.5 md:w-5 md:h-5 object-contain brightness-200" />
                        <span>Play</span>
                      </Link>
                      <Link
                        href={`/anime/${show.id}`}
                        className="bg-neutral-800/70 hover:bg-neutral-700/80 border border-neutral-600 text-white font-bold text-xs md:text-sm px-4 py-2 md:px-6 md:py-3 rounded-md transition-all duration-200 hover:scale-[1.03] active:scale-95 backdrop-blur-sm"
                      >
                        More Info
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="absolute bottom-6 right-4 sm:right-8 z-20 flex items-center space-x-2">
              {topFiveTrending.map((_, dotIdx) => (
                <button
                  key={dotIdx}
                  onClick={() => setActiveHeroIndex(dotIdx)}
                  className={`h-1.5 transition-all duration-300 rounded-full ${
                    dotIdx === activeHeroIndex ? "w-6 bg-orange-500" : "w-1.5 bg-neutral-600 hover:bg-neutral-400"
                  }`}
                />
              ))}
            </div>
          </section>
        )}

        {/* CONTAINER SHELF GRIDS */}
        <div className={`relative z-10 px-4 sm:px-6 md:px-12 space-y-10 md:space-y-12 ${!isSearching && topFiveTrending.length > 0 ? "mt-6 md:mt-12" : "pt-20 md:pt-24"}`}>
          
          {/* Mobile input field block */}
          <div className="sm:hidden block relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <img src="/Assets/search-icon.png" alt="Search" className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90" />
            </div>
            <input
              type="text"
              placeholder="Search movies, TV or anime..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4 p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* WATCH HISTORY */}
          {!isSearching && watchHistory.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm md:text-lg font-bold uppercase tracking-widest text-neutral-200">
                  Watch History
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {watchHistory.map((item) => (
                  <Link
                    key={item.anilistId}
                    href={`/watch?provider=${item.provider}&anilistId=${item.anilistId}&category=${item.category}&slug=${encodeURIComponent(item.slug)}&epNum=${item.episodeNumber}`}
                    className="group relative bg-neutral-900/30 border border-neutral-900 rounded overflow-hidden hover:border-neutral-700 transition duration-300 flex flex-col"
                  >
                    <div className="relative aspect-video w-full bg-neutral-950 overflow-hidden select-none">
                      <img src={item.episodeImage} alt={item.animeTitle} className="w-full h-full object-cover group-hover:scale-102 transition duration-500" loading="lazy" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />
                      <div className="absolute bottom-2 left-2 z-20 font-mono font-black text-[10px] text-white bg-black/70 px-1.5 py-0.5 rounded border border-neutral-800/40">
                        EP {item.episodeNumber}
                      </div>
                      <div className="absolute bottom-2 right-2 z-20 font-mono text-[9px] text-neutral-300 bg-black/70 px-1.5 py-0.5 rounded border border-neutral-800/40">
                        {formatSecondsToLabel(item.currentTime)} / {formatSecondsToLabel(item.duration)}
                      </div>
                      <div className="absolute bottom-0 inset-x-0 h-1 bg-orange-500/20 z-30">
                        <div className="h-full bg-orange-500 transition-all duration-300" style={{ width: `${item.progressPercent}%` }} />
                      </div>
                    </div>
                    <div className="p-2.5 bg-neutral-900/10 flex-1 flex flex-col justify-center">
                      <h4 className="font-bold text-xs text-neutral-200 truncate group-hover:text-orange-500 transition duration-200">
                        {item.animeTitle}
                      </h4>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* MAIN GRID BLOCK SECTION */}
          <section className="space-y-4 md:space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm md:text-lg font-bold uppercase tracking-widest text-neutral-200">
                {getHeaderTitle()}
              </h3>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-3 gap-y-6 md:gap-x-4 md:gap-y-8">
              {(loading || (searchingLoading && searchPage === 1)) ? (
                <div className="col-span-full py-20 flex flex-col items-center justify-center space-y-3">
                  <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-[10px] font-mono tracking-wider text-neutral-600 uppercase">
                    Synchronizing content repositories...
                  </p>
                </div>
              ) : Array.isArray(standardShowcaseList) && standardShowcaseList.length > 0 ? (
                standardShowcaseList.map((anime) => (
                  <Link 
                    href={getDetailsHref(anime)} 
                    key={anime.id} 
                    className="group flex flex-col space-y-2 outline-none transition-transform duration-200 ease-out hover:-translate-y-1"
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-neutral-900 shadow-md group-hover:shadow-xl group-hover:shadow-black/50 border border-neutral-900 group-hover:border-neutral-700 group-focus:border-orange-500 transition-all duration-200">
                      <img 
                        src={getDisplayCover(anime)} 
                        alt={getDisplayTitle(anime)}
                        className="w-full h-full object-cover object-center transition duration-500 ease-out group-hover:scale-103 group-hover:brightness-90"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                        <div className="bg-orange-500/95 p-2.5 rounded-full scale-90 group-hover:scale-100 transition-transform duration-300 shadow-xl">
                          <img src="/Assets/play-button.png" alt="Play" className="w-4 h-4 object-contain brightness-200" />
                        </div>
                      </div>
                    </div>

                    <div className="px-0.5 space-y-0.5">
                      <h4 className="font-semibold text-xs md:text-sm leading-tight line-clamp-2 text-neutral-300 group-hover:text-orange-500 transition duration-200">
                        {getDisplayTitle(anime)}
                      </h4>
                      <div className="text-[9px] md:text-[10px] font-mono text-neutral-600 tracking-tight font-medium uppercase">
                        Premium Feed
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="bg-neutral-900/30 border border-neutral-900 rounded-lg col-span-full p-12 text-center max-w-sm mx-auto space-y-1">
                  <p className="text-neutral-400 font-semibold text-xs">
                    No matching titles discovered
                  </p>
                  <p className="text-[11px] text-neutral-500 leading-relaxed">
                    Adjust spellings or explore alternative categories.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* LAZY LOAD MORE PAGINATION DESK */}
          {isSearching && hasMoreResults && searchResults.length >= RESULTS_PER_PAGE && (
            <div className="w-full pt-6 flex justify-center">
              <button
                onClick={handleLoadMoreSearch}
                disabled={searchingLoading}
                className="px-6 py-2.5 rounded bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-850 font-medium text-xs font-mono tracking-wider text-neutral-300 uppercase transition disabled:opacity-50 flex items-center space-x-3"
              >
                {searchingLoading && (
                  <div className="w-3 h-3 border border-neutral-400 border-t-transparent rounded-full animate-spin" />
                )}
                <span>Load More Series</span>
              </button>
            </div>
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
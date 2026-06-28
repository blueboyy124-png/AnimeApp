"use client";

import { useState, useEffect, ChangeEvent } from "react";
import Link from "next/link";
import AccountBar from "./accountbar";

interface AnimeCard {
  id: number;
  title: {
    english?: string;
    romaji?: string;
  };
  coverImage: {
    extraLarge?: string;
    large?: string;
  };
  bannerImage?: string;
  description?: string;
  genres?: string[];
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

export default function HomePage() {
  const [trending, setTrending] = useState<AnimeCard[]>([]);
  const [currentFeed, setCurrentFeed] = useState<AnimeCard[]>([]);
  const [activeCategory, setActiveCategory] = useState<FeedCategory>("trending");
  
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<AnimeCard[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchingLoading, setSearchingLoading] = useState<boolean>(false);
  
  // Advanced Pagination Engine Tracking
  const [searchPage, setSearchPage] = useState<number>(1);
  const [hasMoreResults, setHasMoreResults] = useState<boolean>(true);
  
  // Controlled index state for the full-width Netflix spotlight carousel
  const [activeHeroIndex, setActiveHeroIndex] = useState<number>(0);

  // Watch History State Log Collection
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://anime-api-one-cyan.vercel.app/api";
  const RESULTS_PER_PAGE = 20;

  // Fetch Hero Banner Spotlight Content (Always keeps top trending) on mount
  useEffect(() => {
    fetch(`${API_BASE}/trending`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.results && Array.isArray(data.results.results)) {
          setTrending(data.results.results);
        } else if (data && Array.isArray(data.results)) {
          setTrending(data.results);
        } else {
          setTrending([]);
        }
      })
      .catch((err) => console.error("Error fetching trending spotlight banner:", err));
  }, [API_BASE]);

  // Load category feeds on navigation click changes
  useEffect(() => {
    setLoading(true);
    let targetUrl = `${API_BASE}/${activeCategory}`;
    
    // Recommendations maps to standard mock item ID 20 if global tracking is absent
    if (activeCategory === "recommendations") {
      targetUrl = `${API_BASE}/anime/20/recommendations`;
    }

    fetch(targetUrl)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.results && Array.isArray(data.results.results)) {
          setCurrentFeed(data.results.results);
        } else if (data && Array.isArray(data.results)) {
          setCurrentFeed(data.results);
        } else if (data && Array.isArray(data)) {
          setCurrentFeed(data);
        } else {
          setCurrentFeed([]);
        }
      })
      .catch((err) => {
        console.error(`Error loading category: ${activeCategory}`, err);
        setCurrentFeed([]);
      })
      .finally(() => setLoading(false));
  }, [activeCategory, API_BASE]);

  // Read Watch History client registry values and strip series duplicates
  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem("streamanime_watch_history");
      if (storedHistory) {
        const parsedHistory: WatchHistoryItem[] = JSON.parse(storedHistory);
        
        // Sort first to ensure most recently watched episodes are processed first
        parsedHistory.sort((a, b) => b.updatedAt - a.updatedAt);
        
        // Filter out older duplicates by tracking which unique anilistIds have been seen
        const seenAnimeIds = new Set<string>();
        const uniqueSeriesHistory = parsedHistory.filter((item) => {
          if (seenAnimeIds.has(item.anilistId)) {
            return false; // Skip this item, it's an older episode/interaction with this series
          }
          seenAnimeIds.add(item.anilistId);
          return true; // Keep this item, it is the most recent
        });

        setWatchHistory(uniqueSeriesHistory);
      }
    } catch (e) {
      console.error("Failed executing client tracking history sync routine:", e);
    }
  }, []);

  // 4-Second Interval Automatic Rotator Engine for the top 5 Spotlight Shows
  useEffect(() => {
    if (trending.length === 0) return;
    const limit = Math.min(trending.length, 5);
    const interval = setInterval(() => {
      setActiveHeroIndex((prevIndex) => (prevIndex + 1) % limit);
    }, 4000);

    return () => clearInterval(interval);
  }, [trending]);

  // Paginated search interacting directly with your local server endpoint
  const performSearchFetch = async (query: string, targetPage: number, appendMode: boolean) => {
    if (!query.trim()) return;
    setSearchingLoading(true);
    
    try {
      const url = `${API_BASE}/search?query=${encodeURIComponent(query)}&page=${targetPage}&per_page=${RESULTS_PER_PAGE}`;
      const res = await fetch(url);
      const data = await res.json();
      
      let parsedResults: AnimeCard[] = [];
      if (data && data.results && Array.isArray(data.results.results)) {
        parsedResults = data.results.results;
      } else if (data && Array.isArray(data.results)) {
        parsedResults = data.results;
      } else if (data && Array.isArray(data)) {
        parsedResults = data;
      }

      if (Array.isArray(parsedResults)) {
        if (appendMode) {
          setSearchResults((prev) => [...prev, ...parsedResults]);
        } else {
          setSearchResults(parsedResults);
        }
        
        if (parsedResults.length < RESULTS_PER_PAGE) {
          setHasMoreResults(false);
        } else {
          setHasMoreResults(true);
        }
      } else {
        if (!appendMode) setSearchResults([]);
        setHasMoreResults(false);
      }
    } catch (err) {
      console.error("Local search query exception track dropped:", err);
      if (!appendMode) setSearchResults([]);
    } finally {
      setSearchingLoading(false);
    }
  };

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    setSearchPage(1);

    if (query.trim().length > 2) {
      performSearchFetch(query, 1, false);
    } else {
      setSearchResults([]);
    }
  };

  const handleLoadMoreSearch = () => {
    const nextPage = searchPage + 1;
    setSearchPage(nextPage);
    performSearchFetch(searchQuery, nextPage, true);
  };

  // Human Time Layout Timestamp Labeler
  const formatSecondsToLabel = (seconds: number) => {
    if (isNaN(seconds) || seconds <= 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isSearching = searchQuery.trim().length > 2;
  const standardShowcaseList = isSearching ? searchResults : currentFeed;
  const topFiveTrending = trending.slice(0, 5);

  const cleanDescription = (htmlStr?: string) => {
    if (!htmlStr) return "Stream the latest episodes immediately in high definition.";
    return htmlStr.replace(/<\/?[^>]+(>|$)/g, "").substring(0, 140) + "...";
  };

  const getHeaderTitle = () => {
    if (isSearching) return `Search Index: "${searchQuery}"`;
    if (activeCategory === "trending") return "Trending";
    if (activeCategory === "upcoming") return "Upcoming Releases";
    if (activeCategory === "recommendations") return "Recommended for You";
    if (activeCategory === "popular") return "Popular Trends";
    return "Anime Feed";
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased selection:bg-orange-500 selection:text-white pb-20 overflow-x-hidden">
      
      {/* GLOBAL NAVIGATION HEADER */}
      <header className="fixed top-0 inset-x-0 h-16 bg-gradient-to-b from-black/90 to-transparent backdrop-blur-md z-50 flex items-center justify-between px-6 md:px-12 border-b border-neutral-900/40">
        <div className="flex items-center space-x-12">
          <button 
            onClick={() => { setActiveCategory("trending"); setSearchQuery(""); }} 
            className="text-2xl font-black tracking-tighter text-orange-500 hover:opacity-90 transition text-left cursor-pointer"
          >
            STREAMANIME
          </button>
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-neutral-400">
            <button 
              onClick={() => { setActiveCategory("trending"); setSearchQuery(""); }} 
              className={`transition cursor-pointer ${activeCategory === "trending" && !isSearching ? "text-neutral-100 font-bold" : "hover:text-neutral-300"}`}
            >
              Home
            </button>
            <button 
              onClick={() => { setActiveCategory("upcoming"); setSearchQuery(""); }} 
              className={`transition cursor-pointer ${activeCategory === "upcoming" && !isSearching ? "text-neutral-100 font-bold" : "hover:text-neutral-300"}`}
            >
              Upcoming
            </button>
            <button 
              onClick={() => { setActiveCategory("recommendations"); setSearchQuery(""); }} 
              className={`transition cursor-pointer ${activeCategory === "recommendations" && !isSearching ? "text-neutral-100 font-bold" : "hover:text-neutral-300"}`}
            >
              Recommendations
            </button>
            <button 
              onClick={() => { setActiveCategory("popular"); setSearchQuery(""); }} 
              className={`transition cursor-pointer ${activeCategory === "popular" && !isSearching ? "text-neutral-100 font-bold" : "hover:text-neutral-300"}`}
            >
              Popular
            </button>
          </nav>
        </div>

        {/* CONTROLS AREA: SEARCH DECK + PROFILE SYNCHRONIZATION */}
        <div className="flex items-center space-x-4 ml-auto">
          {/* SEARCH DECK INPUT FRAME */}
          <div className="relative max-w-xs w-48 lg:w-64 hidden sm:block">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <img 
                src="/Assets/search-icon.png" 
                alt="Search" 
                className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90"
              />
            </div>
            <input
              type="text"
              placeholder="Search titles, genres..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4 py-1.5 rounded-md bg-neutral-900/90 border border-neutral-800 text-sm placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:bg-neutral-900 transition duration-200"
            />
          </div>

          {/* INTEGRATED CLOUD HUB SYNC COMPONENT */}
          <AccountBar />
        </div>
      </header>

      {/* NETFLIX-STYLE FULL-WIDTH SPOTLIGHT SLIDER (TOP 1-5 ROTATOR) */}
      {!isSearching && topFiveTrending.length > 0 && (
        <section className="relative w-full h-[75vh] md:h-[85vh] bg-black overflow-hidden pt-16">
          
          <div 
            className="w-full h-full flex transition-transform duration-700 ease-in-out"
            style={{ transform: `translateX(-${activeHeroIndex * 100}%)` }}
          >
            {topFiveTrending.map((show, index) => (
              <div 
                key={show.id} 
                className="relative w-full h-full flex-shrink-0 overflow-hidden"
              >
                <img 
                  src={show.bannerImage || show.coverImage?.extraLarge || show.coverImage?.large} 
                  alt="Spotlight Artwork"
                  className="absolute inset-0 w-full h-full object-cover object-center opacity-35"
                />
                
                <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/30 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-transparent to-transparent" />

                <div className="absolute inset-x-0 bottom-0 p-8 md:p-16 space-y-4 z-10 max-w-3xl">
                  <div className="flex items-center space-x-3.5">
                    <span className="text-5xl md:text-6xl font-black text-orange-500 tracking-tighter italic select-none">
                      #{index + 1}
                    </span>
                    <span className="text-[10px] font-bold tracking-widest text-neutral-200 uppercase bg-neutral-900/90 px-2.5 py-0.5 rounded border border-neutral-800">
                      Trending Spotlight
                    </span>
                  </div>

                  <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white leading-tight drop-shadow-md line-clamp-2">
                    {show.title?.english || show.title?.romaji}
                  </h2>
                  
                  <p className="text-xs md:text-sm text-neutral-300 max-w-xl line-clamp-3 leading-relaxed drop-shadow">
                    {cleanDescription(show.description)}
                  </p>

                  <div className="flex items-center space-x-3 pt-3">
                    <Link 
                      href={`/anime/${show.id}`}
                      className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs md:text-sm px-5 py-3 rounded transition-all flex items-center space-x-2.5 active:scale-95 shadow-lg"
                    >
                      <img 
                        src="/Assets/play-button.png" 
                        alt="Play" 
                        className="w-4 h-4 md:w-5 md:h-5 object-contain brightness-200"
                      />
                      <span>Watch Now</span>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="absolute bottom-6 right-8 z-20 flex items-center space-x-2">
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

          <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-neutral-950 to-transparent pointer-events-none z-10" />
        </section>
      )}

      {/* COMPONENT BODY TRACK LISTINGS */}
      <div className={`px-6 md:px-12 space-y-12 ${!isSearching && topFiveTrending.length > 0 ? "mt-12 relative z-20" : "pt-24"}`}>
        
        {/* Mobile Input Container */}
        <div className="sm:hidden block relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <img 
              src="/Assets/search-icon.png" 
              alt="Search" 
              className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90"
            />
          </div>
          <input
            type="text"
            placeholder="Search anime..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 p-3 rounded-lg bg-neutral-900 border border-neutral-800 text-white text-sm focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* WATCH HISTORY EXPANSION SHELF DECK */}
        {!isSearching && watchHistory.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-900 pb-3">
              <h3 className="text-base md:text-lg font-black uppercase tracking-widest text-orange-500">
                Watch History
              </h3>
              <button 
                onClick={() => { localStorage.removeItem("streamanime_watch_history"); setWatchHistory([]); }}
                className="text-[10px] font-mono tracking-wider text-neutral-600 hover:text-red-400 uppercase transition cursor-pointer"
              >
                Clear Cache
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {watchHistory.map((item) => (
                <Link
                  key={item.anilistId}
                  href={`/watch?provider=${item.provider}&anilistId=${item.anilistId}&category=${item.category}&slug=${encodeURIComponent(item.slug)}&epNum=${item.episodeNumber}`}
                  className="group relative bg-neutral-900/30 border border-neutral-900 rounded overflow-hidden hover:border-neutral-700 transition duration-300 flex flex-col"
                >
                  {/* IMAGE VIEW COMPONENT WRAPPER */}
                  <div className="relative aspect-video w-full bg-neutral-950 overflow-hidden select-none">
                    <img
                      src={item.episodeImage}
                      alt={item.animeTitle}
                      className="w-full h-full object-cover group-hover:scale-102 transition duration-500"
                      loading="lazy"
                    />

                    {/* Masking Layout Overlay Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />

                    {/* SPEC: EPISODE NUMBER OVERLAY ON BOTTOM LEFT */}
                    <div className="absolute bottom-2 left-2 z-20 font-mono font-black text-[10px] text-white bg-black/70 px-1.5 py-0.5 rounded border border-neutral-800/40">
                      EP {item.episodeNumber}
                    </div>

                    {/* SPEC: RUNTIME TIMESTAMP RATIO STAMP ON BOTTOM RIGHT */}
                    <div className="absolute bottom-2 right-2 z-20 font-mono text-[9px] text-neutral-300 bg-black/70 px-1.5 py-0.5 rounded border border-neutral-800/40">
                      {formatSecondsToLabel(item.currentTime)} / {formatSecondsToLabel(item.duration)}
                    </div>

                    {/* SPEC: MINI PROGRESS TRACK SLIDER ANCHORED ON BOTTOM EDGE */}
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-neutral-800 z-30">
                      <div 
                        className="h-full bg-orange-500 transition-all duration-300" 
                        style={{ width: `${item.progressPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* CAPTION INFO PANEL */}
                  <div className="p-3 bg-neutral-900/10 flex-1 flex flex-col justify-center">
                    <h4 className="font-bold text-xs text-neutral-200 truncate group-hover:text-orange-500 transition duration-200">
                      {item.animeTitle}
                    </h4>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* SECTION FEED SEPARATOR */}
        <section className="space-y-6">
          <div className="flex items-center justify-between border-b border-neutral-900 pb-3">
            <h3 className="text-base md:text-lg font-bold uppercase tracking-widest text-neutral-200">
              {getHeaderTitle()}
            </h3>
            {!isSearching && (
              <span className="text-[11px] text-neutral-600 font-mono">
                {standardShowcaseList.length} titles synchronized
              </span>
            )}
          </div>
          
          {/* CARDS DISPLAY ROW GRID */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-8">
            {(loading || (searchingLoading && searchPage === 1)) ? (
              <div className="col-span-full py-20 flex flex-col items-center justify-center space-y-3">
                <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-[10px] font-mono tracking-wider text-neutral-600 uppercase">
                  Synchronizing core content repositories...
                </p>
              </div>
            ) : Array.isArray(standardShowcaseList) && standardShowcaseList.length > 0 ? (
              standardShowcaseList.map((anime) => (
                <Link 
                  href={`/anime/${anime.id}`} 
                  key={anime.id} 
                  className="group flex flex-col space-y-2.5 outline-none"
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden rounded bg-neutral-900 shadow-md border border-neutral-900 group-hover:border-neutral-700 group-focus:border-orange-500 transition-all duration-300">
                    <img 
                      src={anime.coverImage?.extraLarge || anime.coverImage?.large || "https://placehold.co/400x600?text=No+Cover"} 
                      alt={anime.title?.english || anime.title?.romaji || "Anime Cover"}
                      className="w-full h-full object-cover object-center transition duration-500 ease-out group-hover:scale-103 group-hover:brightness-90"
                      loading="lazy"
                    />
                    
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                      <div className="bg-orange-500/95 p-3 rounded-full scale-90 group-hover:scale-100 transition-transform duration-300 shadow-xl">
                        <img 
                          src="/Assets/play-button.png" 
                          alt="Play" 
                          className="w-5 h-5 object-contain brightness-200"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="px-0.5 space-y-0.5">
                    <h4 className="font-semibold text-xs md:text-sm leading-tight line-clamp-2 text-neutral-300 group-hover:text-orange-500 transition duration-200">
                      {anime.title?.english || anime.title?.romaji || "Untitled Show"}
                    </h4>
                    <div className="text-[10px] font-mono text-neutral-600 tracking-tight font-medium uppercase">
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

        {/* PAGINATION PROGRESSIVE INTERACTION LAYER */}
        {isSearching && hasMoreResults && searchResults.length >= RESULTS_PER_PAGE && (
          <div className="w-full pt-10 flex justify-center">
            <button
              onClick={handleLoadMoreSearch}
              disabled={searchingLoading}
              className="px-8 py-3 rounded bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-850 font-medium text-xs font-mono tracking-wider text-neutral-300 uppercase transition disabled:opacity-50 flex items-center space-x-3"
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
  );
}
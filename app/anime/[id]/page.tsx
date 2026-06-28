"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AnimeInfo {
  id: number;
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
}

interface EpisodeData {
  id: string; 
  number: number;
  title?: string;
  description?: string;
  image?: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

type ViewStyle = "compact" | "detailed" | "cinematic";

export default function AnimeDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  
  const [info, setInfo] = useState<AnimeInfo | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Layout presentation toggler state
  const [viewStyle, setViewStyle] = useState<ViewStyle>("compact");

  // Pagination Ranges Engine Tracking
  const [activeRangeIndex, setActiveRangeIndex] = useState<number>(0);

  const API_BASE = "https://anime-api-one-cyan.vercel.app/api";

  useEffect(() => {
    async function fetchData() {
      try {
        const infoRes = await fetch(`${API_BASE}/info/${id}`);
        const infoData = await infoRes.json();
        if (infoData && infoData.results) {
          setInfo(infoData.results);
        } else {
          setInfo(infoData);
        }

        const epRes = await fetch(`${API_BASE}/episodes/${id}`);
        const epData = await epRes.json();
        console.log("Raw Episode Payload:", epData);

        if (epData && epData.results && epData.results.providers) {
          const providers = epData.results.providers;
          const targetProvider = providers.gogoanime || providers.zoro || Object.values(providers)[0] as any;
          
          if (targetProvider && targetProvider.episodes && Array.isArray(targetProvider.episodes.sub)) {
            const sortedEpisodes = [...targetProvider.episodes.sub].sort((a, b) => a.number - b.number);
            setEpisodes(sortedEpisodes);
          } else {
            setEpisodes([]);
          }
        } else {
          setEpisodes([]);
        }

      } catch (err) {
        console.error("Failed to load anime info structure mappings:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center space-y-3 font-sans">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-[10px] font-mono tracking-wider text-neutral-600 uppercase">
          Synchronizing content repository records...
        </p>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center font-sans">
        <div className="bg-neutral-900/30 border border-neutral-900 rounded-lg p-12 text-center max-w-sm space-y-1">
          <p className="text-neutral-400 font-semibold text-xs">Anime document not discovered</p>
          <p className="text-[11px] text-neutral-500 leading-normal">
            Verify indices or re-route browse directories back home.
          </p>
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
      chunkRanges.push({
        start: rangeStart,
        end: rangeEnd,
        label: `${rangeStart}-${rangeEnd}`
      });
    }
  }

  const currentDisplayedEpisodes = chunkRanges.length > 0 
    ? episodes.slice(chunkRanges[activeRangeIndex].start - 1, chunkRanges[activeRangeIndex].end)
    : episodes;

  const cleanDescription = (htmlStr?: string) => {
    if (!htmlStr) return "Premium broadcast summary file not mapped.";
    return htmlStr.replace(/<\/?[^>]+(>|$)/g, "");
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased pb-20 selection:bg-orange-500 selection:text-white overflow-x-hidden pt-16">
      
      {/* GLOBAL PERSISTENT NAVIGATION HEADER */}
      <header className="fixed top-0 inset-x-0 h-16 bg-gradient-to-b from-black/90 to-transparent backdrop-blur-md z-50 flex items-center justify-between px-6 md:px-12 border-b border-neutral-900/40">
        <div className="flex items-center space-x-12">
          <Link 
            href="/"
            className="text-2xl font-black tracking-tighter text-orange-500 hover:opacity-90 transition text-left"
          >
            STREAMANIME
          </Link>
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-neutral-400">
            <Link href="/" className="transition hover:text-neutral-200">
              Home
            </Link>
            <Link href="/?feed=upcoming" className="transition hover:text-neutral-200">
              Upcoming
            </Link>
            <Link href="/?feed=recommendations" className="transition hover:text-neutral-200">
              Recommendations
            </Link>
            <Link href="/?feed=popular" className="transition hover:text-neutral-200">
              Popular
            </Link>
          </nav>
        </div>

        {/* SEARCH DECK INPUT FRAME */}
        <div className="relative max-w-xs w-full hidden sm:block ml-6">
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
            onClick={() => router.push("/")}
            className="w-full pl-10 pr-4 py-1.5 rounded-md bg-neutral-900/90 border border-neutral-800 text-sm placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:bg-neutral-900 transition duration-200 cursor-pointer"
          />
        </div>
      </header>

      {/* GLOBAL BACKGROUND BACKDROP HERO SHIELD */}
      <div className="relative w-full h-[35vh] md:h-[45vh] bg-black overflow-hidden border-b border-neutral-900/40">
        <img 
          src={info.coverImage?.extraLarge || info.coverImage?.large} 
          alt="Backdrop Viewport Artwork"
          className="w-full h-full object-cover object-center opacity-20 blur-xl scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-12 -mt-36 relative z-10 space-y-12">
        
        <div>
          <Link 
            href="/" 
            className="inline-flex items-center space-x-2 text-[10px] font-mono tracking-wider text-neutral-400 hover:text-orange-500 uppercase transition"
          >
            <span>Back to Browse</span>
          </Link>
        </div>

        {/* PROFILE SPLIT BLOCK DETAILS ROW */}
        <div className="flex flex-col md:flex-row gap-8 md:gap-12 items-start">
          <div className="w-48 md:w-64 aspect-[2/3] shrink-0 bg-neutral-900 rounded shadow-2xl overflow-hidden border border-neutral-900 select-none">
            <img 
              src={info.coverImage?.extraLarge || info.coverImage?.large || "https://placehold.co/400x600?text=No+Cover"} 
              alt={info.title?.english || info.title?.romaji || "Anime Cover"} 
              className="w-full h-full object-cover object-center"
            />
          </div>

          <div className="space-y-5 flex-1">
            <div className="text-[10px] font-bold tracking-widest text-neutral-200 uppercase bg-neutral-900 border border-neutral-800 px-2.5 py-0.5 rounded inline-block">
              Premium Broadcast Feed
            </div>
            
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white leading-none">
              {info.title?.english || info.title?.romaji || "Untitled Anime"}
            </h1>

            <p className="text-neutral-400 text-xs md:text-sm leading-relaxed max-w-4xl text-justify">
              {cleanDescription(info.description)}
            </p>

            <div className="flex flex-wrap gap-1.5 pt-2">
              {info.genres?.map((genre) => (
                <span 
                  key={genre} 
                  className="bg-neutral-900/60 border border-neutral-900 px-3 py-1 rounded text-[10px] font-mono tracking-tight text-neutral-400"
                >
                  {genre}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* EPISODE ANCHOR SEPARATORS STRUCTURE */}
        <div className="space-y-6 pt-6">
          <div className="border-b border-neutral-900 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm md:text-base font-bold uppercase tracking-widest text-neutral-200">
                Episode Catalog
              </h2>
              <div className="text-[11px] font-mono text-neutral-600">
                {totalEpisodesCount} files synchronized
              </div>
            </div>

            {/* THREE-WAY PRESENTATION MULTI-LOOK SWITCHER BUTTON CONTROL */}
            <div className="flex items-center bg-neutral-900 border border-neutral-800 p-1 rounded space-x-1 self-start sm:self-auto">
              <button
                onClick={() => setViewStyle("compact")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono tracking-tight transition ${
                  viewStyle === "compact" ? "bg-orange-500 text-white font-bold shadow" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Compact
              </button>
              <button
                onClick={() => setViewStyle("detailed")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono tracking-tight transition ${
                  viewStyle === "detailed" ? "bg-orange-500 text-white font-bold shadow" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Detailed
              </button>
              <button
                onClick={() => setViewStyle("cinematic")}
                className={`px-3 py-1.5 rounded text-[10px] font-mono tracking-tight transition ${
                  viewStyle === "cinematic" ? "bg-orange-500 text-white font-bold shadow" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Cinematic
              </button>
            </div>
          </div>

          {/* DYNAMIC PAGINATION HUB MATRIX ROW */}
          <div className="flex flex-col lg:flex-row gap-8 items-start">
            
            {chunkRanges.length > 0 && (
              <div className="w-full lg:w-48 shrink-0 flex lg:flex-col flex-wrap gap-1 bg-neutral-900/30 border border-neutral-900 p-2 rounded">
                <div className="text-[9px] font-mono tracking-wider text-neutral-600 uppercase p-2 hidden lg:block border-b border-neutral-900 mb-1">
                  Indices Filter
                </div>
                {chunkRanges.map((range, index) => (
                  <button
                    key={range.label}
                    onClick={() => { setActiveRangeIndex(index); }}
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

            {/* CATALOG SHOWCASE TRACK GRID LAYOUT */}
            <div className="flex-1 w-full">
              {currentDisplayedEpisodes.length > 0 ? (
                <div className={
                  viewStyle === "compact" 
                    ? "grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-10 gap-2"
                    : viewStyle === "detailed"
                    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
                    : "grid grid-cols-1 gap-4"
                }>
                  {currentDisplayedEpisodes.map((ep) => {
                    const cleanSlug = ep.id.includes('/') ? ep.id.split('/').pop() : ep.id;
                    const providerName = ep.id.includes('watch/') ? ep.id.split('/')[1] : "gogoanime";
                    const fallbackDescription = "Broadcast stream payload data successfully mounted and synchronized.";

                    // OPTION 1: COMPACT GRID LOOK
                    if (viewStyle === "compact") {
                      return (
                        <Link
                          key={ep.id}
                          href={`/watch?provider=${providerName}&anilistId=${id}&category=sub&slug=${encodeURIComponent(cleanSlug || "")}&epNum=${ep.number}`}
                          className="bg-neutral-900/50 border border-neutral-900 hover:border-neutral-700 py-3.5 rounded text-center transition block group outline-none focus:border-orange-500"
                        >
                          <span className="text-neutral-300 group-hover:text-orange-500 font-bold text-xs transition duration-200 block">
                            {ep.number}
                          </span>
                        </Link>
                      );
                    }

                    // OPTION 2: DETAILED SNAPSHOT LOOK
                    if (viewStyle === "detailed") {
                      return (
                        <Link
                          key={ep.id}
                          href={`/watch?provider=${providerName}&anilistId=${id}&category=sub&slug=${encodeURIComponent(cleanSlug || "")}&epNum=${ep.number}`}
                          className="bg-neutral-900/50 border border-neutral-900 hover:border-neutral-700 p-4 rounded transition block group outline-none focus:border-orange-500 space-y-1 text-left"
                        >
                          <div className="text-neutral-200 group-hover:text-orange-500 font-bold text-xs transition duration-200 truncate">
                            Episode {ep.number} {ep.title ? `— ${ep.title}` : ""}
                          </div>
                          <p className="text-[10px] text-neutral-500 line-clamp-1 leading-normal">
                            {ep.description ? cleanDescription(ep.description) : fallbackDescription}
                          </p>
                        </Link>
                      );
                    }

                    // OPTION 3: CINEMATIC LARGE WIDE RECTANGLE CARD LOOK
                    return (
                      <Link
                        key={ep.id}
                        href={`/watch?provider=${providerName}&anilistId=${id}&category=sub&slug=${encodeURIComponent(cleanSlug || "")}&epNum=${ep.number}`}
                        className="bg-neutral-900/40 border border-neutral-900 hover:border-neutral-800 rounded overflow-hidden transition flex h-28 md:h-32 group outline-none focus:border-orange-500 text-left"
                      >
                        <div className="w-1/3 h-full shrink-0 relative bg-neutral-900 border-r border-neutral-900 overflow-hidden select-none">
                          <img 
                            src={ep.image || (info as any).bannerImage || (info as any).banner || info.coverImage?.large || "https://placehold.co/300x180?text=Episode+Preview"} 
                            alt={`Episode ${ep.number} Grid Capture`}
                            className="w-full h-full object-cover object-center transition duration-500 group-hover:scale-102"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                          
                          <div className="absolute bottom-2 left-3 bg-orange-500 text-white font-mono font-black text-[10px] tracking-tight px-1.5 py-0.5 rounded shadow-lg">
                            EP {ep.number}
                          </div>
                        </div>

                        <div className="p-4 flex-1 min-w-0 flex flex-col justify-center space-y-1.5">
                          <h3 className="font-bold text-xs md:text-sm text-neutral-200 group-hover:text-orange-500 transition duration-200 truncate leading-tight">
                            {ep.title ? ep.title : `Episode ${ep.number} Broadcast`}
                          </h3>
                          <p className="text-[11px] text-neutral-400 line-clamp-2 md:line-clamp-3 leading-relaxed text-justify pr-2">
                            {ep.description ? cleanDescription(ep.description) : fallbackDescription}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-neutral-900/10 border border-neutral-900/60 rounded-lg p-12 text-center max-w-sm mx-auto space-y-1">
                  <p className="text-neutral-500 font-semibold text-xs">
                    No playable streams returned
                  </p>
                  <p className="text-[11px] text-neutral-600 leading-normal">
                    This item has no tracked episodes indexed inside your data provider.
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </main>
  );
}
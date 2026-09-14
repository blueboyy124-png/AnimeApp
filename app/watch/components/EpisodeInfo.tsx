import React, { useEffect, useRef, useState } from "react";
import ToggleSwitch from "./ToggleSwitch";

export interface EpisodeInfoProps {
  isExternalMovie: boolean;
  isExternalMedia: boolean;
  animeTitle?: string;
  epNum: string;
  episodeTitle: string;
  mediaAirDate: string;
  watchProviders: Array<{ name: string; logo?: string }>;
  navigateToPrevEpisode: () => void;
  navigateToNextEpisode: () => void;
  hasPrevEpisode: boolean;
  hasNextEpisodeElement: boolean;
  handleDownload: () => void;
  downloadProgress: number | null;
  downloadedFlag: boolean;
  activeCategory: "sub" | "dub";
  handleCategoryChange: (cat: "sub" | "dub") => void;
  hasDubAvailable: boolean;
  provider: string;
  handleProviderChange: (prov: string) => void;
  availableProviders: string[];
  autoplay: boolean;
  toggleAutoplayState: () => void;
  autoskip: boolean;
  toggleAutoskipState: () => void;
  autonext: boolean;
  toggleAutonextState: () => void;
  episodeInfoExpanded: boolean;
  setEpisodeInfoExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  episodeDesc?: string;
  isPlaying: boolean;
  togglePlay: () => void;
  /** Optional — only rendered when the parent actually wires up real state.
   *  No handler means no button; we don't fabricate actions that don't exist. */
  isInMyList?: boolean;
  onToggleMyList?: () => void;
  likeState?: "like" | "dislike" | null;
  onLike?: () => void;
  onDislike?: () => void;
}

const cleanDescription = (html?: string) => {
  if (!html) return "No description available.";
  return html.replace(/<\/?[^>]+(>|$)/g, "");
};

export default function EpisodeInfo({
  isExternalMovie,
  isExternalMedia,
  animeTitle,
  epNum,
  episodeTitle,
  mediaAirDate,
  watchProviders,
  navigateToPrevEpisode,
  navigateToNextEpisode,
  hasPrevEpisode,
  hasNextEpisodeElement,
  handleDownload,
  downloadProgress,
  downloadedFlag,
  activeCategory,
  handleCategoryChange,
  hasDubAvailable,
  provider,
  handleProviderChange,
  availableProviders,
  autoplay,
  toggleAutoplayState,
  autoskip,
  toggleAutoskipState,
  autonext,
  toggleAutonextState,
  episodeInfoExpanded,
  setEpisodeInfoExpanded,
  episodeDesc,
  isPlaying,
  togglePlay,
  isInMyList,
  onToggleMyList,
  likeState,
  onLike,
  onDislike,
}: EpisodeInfoProps) {
  const description = episodeDesc ? cleanDescription(episodeDesc) : "No description available.";

  // Overflow menu for the things that don't need to live in the main row:
  // previous/next episode and download. Real, existing actions — just not
  // primary enough to sit next to Play.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [moreOpen]);

  return (
    <div className="w-full">
      {/* SHOW + EPISODE — three clear tiers: identity, position, title */}
      <div className="min-w-0">
        {animeTitle && (
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
            {animeTitle}
          </h2>
        )}
        {!isExternalMovie && (
          <p className="text-sm font-medium text-neutral-400 mt-1.5">Episode {epNum}</p>
        )}
        <h1 className="text-2xl sm:text-[28px] font-semibold text-white leading-tight tracking-tight mt-0.5 max-w-3xl">
          {episodeTitle || (isExternalMovie ? "Movie" : "Broadcast Segment")}
        </h1>

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-3 text-sm text-neutral-500">
          {mediaAirDate && (
            <span>{isExternalMovie ? "Released" : "Aired"} {mediaAirDate}</span>
          )}
          {watchProviders.map((p, i) => (
            <span key={p.name} className="flex items-center gap-1.5">
              {(mediaAirDate || i > 0) && <span className="text-neutral-700">·</span>}
              {p.name}
            </span>
          ))}
        </div>

        {/* DESCRIPTION — plain text, not an accordion */}
        <div className="mt-4 max-w-2xl">
          <p className={`text-[15px] text-neutral-400 leading-relaxed ${episodeInfoExpanded ? "" : "line-clamp-2"}`}>
            {description}
          </p>
          {description.length > 140 && (
            <button
              onClick={() => setEpisodeInfoExpanded((v) => !v)}
              className="text-sm font-medium text-neutral-500 hover:text-white transition-colors mt-1"
            >
              {episodeInfoExpanded ? "Show less" : "More"}
            </button>
          )}
        </div>
      </div>

      {/* PRIMARY ACTIONS — Play is the obvious one; everything else recedes */}
      <div className="flex items-center gap-2.5 mt-6">
        <button
          onClick={togglePlay}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-black font-semibold text-sm px-5 py-2.5 rounded-md transition active:scale-[0.98]"
        >
          {isPlaying ? (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play
            </>
          )}
        </button>

        {onToggleMyList && (
          <button
            onClick={onToggleMyList}
            className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.12] text-neutral-200 hover:text-white font-medium text-sm px-4 py-2.5 rounded-md transition active:scale-[0.98]"
          >
            {isInMyList ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {isInMyList ? "Added" : "My List"}
          </button>
        )}

        {onLike && (
          <button
            onClick={onLike}
            title="Like"
            aria-label="Like"
            aria-pressed={likeState === "like"}
            className={`mobile-expand-hitbox w-10 h-10 rounded-full flex items-center justify-center transition active:scale-95 ${
              likeState === "like" ? "bg-orange-500/15 text-orange-500" : "bg-white/[0.06] hover:bg-white/[0.12] text-neutral-300 hover:text-white"
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
              <path d="M7 10v11M15 5.88 14 10h6.29a2 2 0 0 1 1.94 2.5l-1.87 7.5a2 2 0 0 1-1.94 1.5H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 .59-1.41L11 4a2 2 0 0 1 3 1.73V5.88Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onDislike && (
          <button
            onClick={onDislike}
            title="Dislike"
            aria-label="Dislike"
            aria-pressed={likeState === "dislike"}
            className={`mobile-expand-hitbox w-10 h-10 rounded-full flex items-center justify-center transition active:scale-95 ${
              likeState === "dislike" ? "bg-orange-500/15 text-orange-500" : "bg-white/[0.06] hover:bg-white/[0.12] text-neutral-300 hover:text-white"
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
              <path d="M17 14V3M9 18.12 10 14H3.71a2 2 0 0 1-1.94-2.5l1.87-7.5A2 2 0 0 1 5.58 2.5H17a2 2 0 0 1 2 2v8a2 2 0 0 1-.59 1.41L13 20a2 2 0 0 1-3-1.73v-.15Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {!isExternalMovie && (
          <div className="relative ml-auto sm:ml-0" ref={moreRef}>
            <button
              onClick={() => setMoreOpen((v) => !v)}
              title="More"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              className={`mobile-expand-hitbox w-10 h-10 rounded-full flex items-center justify-center transition active:scale-95 ${
                moreOpen ? "bg-white/[0.14] text-white" : "bg-white/[0.06] hover:bg-white/[0.12] text-neutral-300 hover:text-white"
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>

            {moreOpen && (
              <div
                role="menu"
                className="absolute right-0 sm:left-0 sm:right-auto mt-2 w-52 bg-[#161616] border border-white/10 rounded-lg shadow-xl overflow-hidden z-30 py-1.5 animate-[dropdownOpen_150ms_ease-out]"
              >
                <button
                  onClick={() => { setMoreOpen(false); navigateToPrevEpisode(); }}
                  disabled={!hasPrevEpisode}
                  className="w-full flex items-center gap-2.5 text-left px-3.5 py-2.5 text-sm text-neutral-200 hover:bg-white/5 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Previous Episode
                </button>
                <button
                  onClick={() => { setMoreOpen(false); navigateToNextEpisode(); }}
                  disabled={!hasNextEpisodeElement}
                  className="w-full flex items-center gap-2.5 text-left px-3.5 py-2.5 text-sm text-neutral-200 hover:bg-white/5 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Next Episode
                </button>
                <div className="my-1 border-t border-white/10" />
                <button
                  onClick={() => { setMoreOpen(false); handleDownload(); }}
                  disabled={downloadProgress !== null}
                  className="w-full flex items-center gap-2.5 text-left px-3.5 py-2.5 text-sm text-neutral-200 hover:bg-white/5 hover:text-white disabled:opacity-40 transition"
                >
                  {downloadedFlag && downloadProgress === null ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-orange-500"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                  {downloadProgress !== null && downloadProgress !== 100
                    ? `Downloading… ${downloadProgress === -1 ? "" : `${downloadProgress}%`}`
                    : downloadedFlag
                    ? "Saved to Downloads"
                    : "Download episode"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* PLAYBACK SETTINGS — quiet, always visible, but clearly secondary
          to the actions above: no cards, no borders, just small controls. */}
      {!isExternalMovie && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-6 pt-5 border-t border-white/[0.06]">
          <div className="flex items-center gap-5">
            {!isExternalMedia && (
              <div className="relative">
                <select
                  value={activeCategory}
                  onChange={(e) => handleCategoryChange(e.target.value as "sub" | "dub")}
                  className="appearance-none bg-transparent text-neutral-300 hover:text-white pr-5 py-1 text-sm font-medium focus:outline-none cursor-pointer transition-colors"
                >
                  <option value="sub" className="bg-neutral-900">Subbed</option>
                  <option value="dub" disabled={!hasDubAvailable} className="bg-neutral-900">
                    Dubbed {!hasDubAvailable ? "(N/A)" : ""}
                  </option>
                </select>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-neutral-500">
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
            <div className="relative">
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="appearance-none bg-transparent text-neutral-300 hover:text-white pr-5 py-1 text-sm font-medium focus:outline-none cursor-pointer transition-colors"
              >
                {availableProviders.map((pKey) => (
                  <option key={pKey} value={pKey} className="bg-neutral-900">Server {pKey.toUpperCase()}</option>
                ))}
              </select>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-neutral-500">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:ml-auto">
            <ToggleSwitch checked={autoplay} onChange={toggleAutoplayState} label="Auto Play" />
            <ToggleSwitch checked={autoskip} onChange={toggleAutoskipState} label="Skip Intro" />
            <ToggleSwitch checked={autonext} onChange={toggleAutonextState} label="Next Episode" />
          </div>
        </div>
      )}
    </div>
  );
}
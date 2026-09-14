import React from "react";
import Link from "next/link";

export interface SidebarProps {
  isExternalMovie: boolean;
  sidebarTab: "episodes" | "seasons" | "related";
  setSidebarTab: (tab: "episodes" | "seasons" | "related") => void;
  tmdbSeasons: any[];
  selectedTmdbSeason: number;
  setSelectedTmdbSeason: (n: number) => void;
  seasonListRef: React.RefObject<HTMLDivElement | null>;
  episodeListRef: React.RefObject<HTMLDivElement | null>;
  currentDisplayedEpisodes: any[];
  epNum: string;
  provider: string;
  anilistId: string;
  activeCategory: string;
  mediaType: string;
  episodeSnapshot: string;
  duration: number;
  progressMap: Record<string, any>;
  activeTmdbSeasonInfo: any;
  CONTINUE_WATCHING_THRESHOLD: number;
  formatTime: (s: number) => string;
  tmdbSeasonLoading?: boolean;
  totalEpisodesCount: number;
}

const progressKeyFor = (season: number, ep: number) => `${season}-${ep}`;

export default function Sidebar({
  isExternalMovie,
  sidebarTab,
  setSidebarTab,
  tmdbSeasons,
  selectedTmdbSeason,
  setSelectedTmdbSeason,
  seasonListRef,
  episodeListRef,
  currentDisplayedEpisodes,
  epNum,
  provider,
  anilistId,
  activeCategory,
  mediaType,
  episodeSnapshot,
  duration,
  progressMap,
  activeTmdbSeasonInfo,
  CONTINUE_WATCHING_THRESHOLD,
  formatTime,
  tmdbSeasonLoading = false,
  totalEpisodesCount,
}: SidebarProps) {
  if (isExternalMovie) return null;

  return (
    <div className="w-full lg:w-[340px] xl:w-[400px] 2xl:w-[440px] shrink-0 lg:sticky lg:top-24 lg:h-[calc(100vh-7rem)] lg:flex lg:flex-col">
      {/* TAB BAR — stays put; only the content below scrolls */}
      <div className="flex items-center gap-6 border-b border-white/10 px-1 shrink-0">
        {([
          { key: "episodes", label: "Episodes" },
          { key: "seasons", label: "Seasons" },
          { key: "related", label: "Related" },
        ] as const).map((tab) => {
          const active = sidebarTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSidebarTab(tab.key)}
              className={`mobile-expand-hitbox relative pb-3 text-sm font-medium transition-colors cursor-pointer ${
                active ? "text-white" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {tab.label}
              <span
                className={`absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-orange-500 transition-all duration-300 origin-center ${
                  active ? "opacity-100 scale-x-100" : "opacity-0 scale-x-0"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* CONTENT — single scroll region, fills the rest of the viewport on desktop */}
      <div className="mt-4 lg:flex-1 lg:overflow-y-auto lg:min-h-0 pr-1 scrollbar-thin scrollbar-thumb-neutral-800">
        {/* SEASONS */}
        {sidebarTab === "seasons" && tmdbSeasons.length > 1 && (
          <div ref={seasonListRef} className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
            {tmdbSeasons.map((season) => {
              const active = season.number === selectedTmdbSeason;
              return (
                <button
                  key={season.number}
                  data-season-number={season.number}
                  onClick={() => setSelectedTmdbSeason(season.number)}
                  className="text-left group focus:outline-none"
                >
                  <div
                    className={`relative aspect-[2/3] rounded-md overflow-hidden ring-1 transition-all duration-150 ${
                      active ? "ring-orange-500" : "ring-white/10 group-hover:ring-white/25"
                    }`}
                  >
                    <img
                      src={season.poster || episodeSnapshot || "https://placehold.co/400x600?text=Season"}
                      alt={season.name}
                      className={`w-full h-full object-cover transition duration-300 ${
                        active ? "" : "opacity-70 group-hover:opacity-100"
                      }`}
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                    <div className="absolute bottom-1.5 left-1.5 right-1.5">
                      <div
                        className={`text-[10px] font-bold leading-tight line-clamp-2 ${
                          active ? "text-orange-400" : "text-white"
                        }`}
                      >
                        {season.name}
                      </div>
                      <div className="text-[9px] text-neutral-300">{season.episodeCount} eps</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {sidebarTab === "seasons" && tmdbSeasons.length <= 1 && (
          <div className="border border-white/10 rounded-md p-8 text-center space-y-1">
            <p className="text-neutral-500 font-semibold text-xs">No additional seasons</p>
            <p className="text-[10px] text-neutral-600 leading-normal">
              This title only has a single continuous episode run.
            </p>
          </div>
        )}

        {sidebarTab === "related" && (
          <div className="border border-white/10 rounded-md p-8 text-center space-y-1">
            <p className="text-neutral-500 font-semibold text-xs">Related titles coming soon</p>
            <p className="text-[10px] text-neutral-600 leading-normal">
              We&apos;re still building recommendations for this show.
            </p>
          </div>
        )}

        {/* EPISODE CATALOG */}
        {sidebarTab === "episodes" && (
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              {tmdbSeasons.length > 1 ? (
                <div className="relative min-w-0">
                  <select
                    value={selectedTmdbSeason}
                    onChange={(e) => setSelectedTmdbSeason(Number(e.target.value))}
                    className="appearance-none bg-transparent text-base font-semibold text-white pr-6 py-0.5 focus:outline-none cursor-pointer truncate"
                  >
                    {tmdbSeasons.map((s) => (
                      <option key={s.number} value={s.number} className="bg-neutral-900 text-white">
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-neutral-500">
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              ) : (
                <h2 className="text-base font-semibold text-white truncate">
                  {activeTmdbSeasonInfo ? activeTmdbSeasonInfo.name : "Episodes"}
                </h2>
              )}
              <span className="text-[11px] text-neutral-500 shrink-0">
                {tmdbSeasonLoading ? "Loading…" : `${totalEpisodesCount} episode${totalEpisodesCount === 1 ? "" : "s"}`}
              </span>
            </div>

            {tmdbSeasonLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : currentDisplayedEpisodes.length > 0 ? (
              <div ref={episodeListRef} className="flex flex-col gap-2">
                {currentDisplayedEpisodes.map((ep) => {
                  const epSlug = ep.id.includes("/") ? ep.id.split("/").pop() : ep.id;
                  const isActive = Number(ep.number) === parseFloat(epNum);
                  const relativeSeason = activeTmdbSeasonInfo?.number ?? 1;
                  const relativeNumber = activeTmdbSeasonInfo
                    ? Number(ep.number) - activeTmdbSeasonInfo.absoluteOffset
                    : Number(ep.number);
                  const href = `/watch?provider=${provider}&id=${anilistId}&category=${activeCategory}&slug=${encodeURIComponent(
                    epSlug || ""
                  )}&epNum=${ep.number}&type=${mediaType}&season=${relativeSeason}`;
                  const thumb = ep.image || episodeSnapshot || "https://placehold.co/400x225?text=Episode";

                  const epPercent = progressMap[progressKeyFor(relativeSeason, relativeNumber)]?.percent ?? 0;
                  const epWatched = epPercent >= CONTINUE_WATCHING_THRESHOLD;
                  const epDurationLabel = isActive && duration > 0 ? formatTime(duration) : null;

                  const ProgressBar =
                    epPercent > 0 ? (
                      <div className="h-[3px] w-full bg-white/15 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500" style={{ width: `${Math.min(epPercent, 100)}%` }} />
                      </div>
                    ) : null;

                  return (
                    <Link
                      key={ep.id}
                      href={href}
                      data-episode-number={ep.number}
                      className={`mobile-expand-hitbox relative flex items-start gap-3.5 transition-colors duration-150 group outline-none ${
                        isActive
                          ? "bg-white/[0.07] border-l-2 border-orange-500 rounded-r-md p-2.5 -mx-2.5"
                          : "py-2 px-1 -mx-1 rounded-md hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="relative w-32 sm:w-36 shrink-0 aspect-video rounded-md overflow-hidden bg-neutral-900">
                        <img
                          src={thumb}
                          alt={`Episode ${ep.number}`}
                          className={`w-full h-full object-cover transition duration-300 group-hover:brightness-110 ${
                            isActive ? "" : "group-hover:scale-[1.03]"
                          }`}
                          loading="lazy"
                          decoding="async"
                        />
                        <div
                          className={`absolute inset-0 flex items-center justify-center transition ${
                            isActive ? "opacity-100 bg-black/10" : "opacity-0 group-hover:opacity-100 bg-black/20"
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full bg-white/95 flex items-center justify-center">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="black">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                        {epWatched && !isActive && (
                          <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-orange-500 flex items-center justify-center">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        )}
                        {ProgressBar && <div className="absolute bottom-0 left-0 right-0">{ProgressBar}</div>}
                      </div>
                      <div className="min-w-0 flex-1 py-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`text-xs font-semibold tracking-wide transition-colors ${
                              isActive ? "text-orange-500" : "text-neutral-500 group-hover:text-orange-500"
                            }`}
                          >
                            {ep.number}
                          </span>
                          {isActive ? (
                            <span className="flex items-center gap-1 text-[11px] text-orange-500 font-medium shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                              Playing
                            </span>
                          ) : (
                            epDurationLabel && (
                              <span className="text-[11px] text-neutral-600 shrink-0">{epDurationLabel}</span>
                            )
                          )}
                        </div>
                        <h3
                          className={`leading-snug line-clamp-2 mt-1 transition-colors ${
                            isActive ? "text-white font-semibold text-[15px]" : "text-neutral-300 group-hover:text-white font-medium text-sm"
                          }`}
                        >
                          {ep.title || `Episode ${ep.number}`}
                        </h3>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="border border-white/10 rounded-md p-8 text-center space-y-1">
                <p className="text-neutral-500 font-semibold text-xs">No episodes found</p>
                <p className="text-[10px] text-neutral-600 leading-normal">
                  This title has no tracked episodes for this season yet.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
"use client";

import Link from "next/link";
import { memo } from "react";
import { WatchHistoryItem } from "./types";
import { formatSecondsToLabel, ROW_CARD_WIDTH_CLASS, ScrollShelf } from "./cardHelpers";

interface WatchHistoryProps {
  items: WatchHistoryItem[];
}

// The same show can end up saved as two separate history entries with
// different ids — a real AniList id from the native anime pipeline, or a
// TMDB id from the tv/movie pipeline (e.g. an older entry synced from
// before a title's TMDB → AniList match resolved). The write path in
// /watch's commitPlaybackSessionToStorageLog now dedupes new writes by
// title, but this defends against duplicates that are already sitting in
// existing synced history data.
function normalizeHistoryTitleKey(title?: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Some older history rows may carry an `updatedAt` timestamp (added
// alongside the write-path dedup fix) even though it's not part of the
// WatchHistoryItem type yet — read it defensively rather than assuming it's
// there.
type HistoryEntryWithTimestamp = WatchHistoryItem & { updatedAt?: number };

// Lower = preferred, used only as a tiebreaker when two duplicate entries
// for the same show have no (or an equal) updatedAt to go by. The anime
// pipeline is the correct/authoritative one for anime titles — a "tv" entry
// for the same show is what a title looked like before it resolved onto the
// anime pipeline (or a stale entry from before that resolution existed), so
// it's the one that should lose.
function mediaTypeRank(mediaType?: WatchHistoryItem["mediaType"]): number {
  if (mediaType === "movie") return 1;
  if (mediaType === "tv") return 2;
  return 0; // anime / undefined
}

function pickBetterHistoryEntry(
  a: HistoryEntryWithTimestamp,
  b: HistoryEntryWithTimestamp
): HistoryEntryWithTimestamp {
  const updatedA = a.updatedAt ?? 0;
  const updatedB = b.updatedAt ?? 0;
  if (updatedA !== updatedB) return updatedA > updatedB ? a : b;

  const rankA = mediaTypeRank(a.mediaType);
  const rankB = mediaTypeRank(b.mediaType);
  if (rankA !== rankB) return rankA < rankB ? a : b;

  return (b.progressPercent ?? 0) > (a.progressPercent ?? 0) ? b : a;
}

function dedupeHistoryByTitle(items: WatchHistoryItem[]): WatchHistoryItem[] {
  const byKey = new Map<string, HistoryEntryWithTimestamp>();
  const order: string[] = [];

  for (const item of items as HistoryEntryWithTimestamp[]) {
    const key = normalizeHistoryTitleKey(item.animeTitle) || String(item.anilistId);
    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, item);
    } else {
      byKey.set(key, pickBetterHistoryEntry(existing, item));
    }
  }

  return order.map((key) => byKey.get(key)!);
}

function getHistorySeasonLabel(item: WatchHistoryItem): string | null {
  if (item.mediaType === "movie") return null;
  const explicit = item.seasonName?.trim();
  if (explicit) return explicit;
  const season = item.season?.trim();
  return season ? `Season ${season}` : null;
}

// "Continue watching" shelf, backed by `profiles.recent_episodes` in
// Supabase (see page.tsx for the load/sync logic). Renders nothing when
// there's no history yet.
function WatchHistoryComponent({ items }: WatchHistoryProps) {
  const dedupedItems = dedupeHistoryByTitle(items);
  if (dedupedItems.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2.5 text-sm md:text-lg font-bold uppercase tracking-widest text-neutral-200">
          <span className="w-1 h-4 md:h-5 rounded-full bg-orange-500" />
          Watch History
        </h3>
      </div>

      {/* Capped to a max of 5 cards visible per row at once, matching every
          other shelf in the app — see RecommendationRow.tsx / cardHelpers
          for why overflow-x-auto needs the vertical padding trick. */}
      <ScrollShelf ariaLabel="Continue Watching">
        {dedupedItems.map((item) => {
          // mediaType is optional on older history entries (written before the
          // field existed, or synced from another device). Missing/unknown
          // mediaType defaults to the anime pipeline — NOT the TV pipeline —
          // because the anime pipeline is the historical default and uses the
          // AniList ID + provider slug format. Routing a missing mediaType to
          // `type=tv` would send an AniList ID to the TMDB movie/TV endpoint,
          // which queries the wrong show and fails to load.
          const historyHref =
            item.mediaType === "movie"
              ? `/watch?type=movie&id=${item.anilistId}`
              : item.mediaType === "tv"
              ? `/watch?provider=${item.provider}&anilistId=${item.anilistId}&category=${item.category}&slug=${encodeURIComponent(item.slug || "")}&epNum=${item.episodeNumber}&type=tv&season=${item.season || "1"}`
              : `/watch?provider=${item.provider}&anilistId=${item.anilistId}&category=${item.category}&slug=${encodeURIComponent(item.slug)}&epNum=${item.episodeNumber}`;
          const seasonLabel = getHistorySeasonLabel(item);
          const displayTitle = seasonLabel ? `${item.animeTitle} — ${seasonLabel}` : item.animeTitle;

          return (
            <Link
              key={normalizeHistoryTitleKey(item.animeTitle) || item.anilistId}
              href={historyHref}
              className={`group relative ${ROW_CARD_WIDTH_CLASS} bg-neutral-900/30 border border-neutral-900 rounded-md overflow-hidden hover:border-neutral-600 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 transition-all duration-300 flex flex-col`}
            >
              <div className="relative aspect-video w-full bg-neutral-950 overflow-hidden select-none">
                <img
                  src={item.episodeImage || "https://images.unsplash.com/photo-1574375927938-d5a98e8edd86?q=80&w=500&auto=format&fit=crop"}
                  alt={item.animeTitle}
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 flex items-center justify-center z-20">
                  <span className="bg-white text-black rounded-full w-8 h-8 flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 shadow-lg">
                    <img src="/Assets/play-button.png" alt="Resume" className="w-3 h-3 object-contain" />
                  </span>
                </div>

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />

                {(item.mediaType === "anime" || item.mediaType === "tv") && item.episodeNumber && (
                  <div className="absolute bottom-2 left-2 z-20 font-mono font-black text-[10px] text-white bg-black/70 px-1.5 py-0.5 rounded border border-neutral-800/40">
                    EP {item.episodeNumber}
                  </div>
                )}

                <div className="absolute bottom-2 right-2 z-20 font-mono text-[9px] text-neutral-300 bg-black/70 px-1.5 py-0.5 rounded border border-neutral-800/40">
                  {formatSecondsToLabel(item.currentTime)} / {formatSecondsToLabel(item.duration)}
                </div>
                <div className="absolute bottom-1.5 left-2 right-2 h-1 rounded-full bg-white/20 z-30 overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full transition-all duration-300" style={{ width: `${item.progressPercent}%` }} />
                </div>
              </div>
              <div className="p-2.5 bg-neutral-900/10 flex-1 flex flex-col justify-center">
                <h4
                  className="font-bold text-xs text-neutral-200 truncate group-hover:text-orange-500 transition-all duration-300"
                  title={displayTitle}
                >
                  {displayTitle}
                </h4>
              </div>
            </Link>
          );
        })}
      </ScrollShelf>
    </section>
  );
}

export const WatchHistory = memo(WatchHistoryComponent);

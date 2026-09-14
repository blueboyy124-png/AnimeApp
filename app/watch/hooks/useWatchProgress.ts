import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../utils/supabase";
import { getApiBaseUrl } from "../../utils/api";
import { loadProgressMap, getResumeTimeKey } from "../lib/history";
import { dedupeHistoryEntriesByTitle } from "../lib/utils";
import type { ProgressMap } from "../lib/types";

const BACKEND_API = getApiBaseUrl();

interface UseWatchProgressOptions {
  anilistId: string;
  animeTitle: string;
  epNum: string;
  seasonNum: string;
  historySeasonName?: string;
  episodeSnapshot: string;
  provider: string;
  activeCategory: string;
  currentSlug: string;
  isExternalMedia: boolean;
  isExternalMovie: boolean;
}

export function useWatchProgress({
  anilistId,
  animeTitle,
  epNum,
  seasonNum,
  historySeasonName,
  episodeSnapshot,
  provider,
  activeCategory,
  currentSlug,
  isExternalMedia,
  isExternalMovie,
}: UseWatchProgressOptions) {
  const [progressMap, setProgressMap] = useState<ProgressMap>({});

  // Load Continue Watching progress for this title
  useEffect(() => {
    if (!anilistId || anilistId === "0") return;
    setProgressMap(loadProgressMap(anilistId));
    const onFocus = () => setProgressMap(loadProgressMap(anilistId));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [anilistId]);

  const commitPlaybackSessionToStorageLog = useCallback(async (current: number, total: number) => {
    if (!anilistId || anilistId === "0" || !total || total <= 0) return;
    try {
      const activeId = localStorage.getItem("streamanime_active_profile_id");
      const storageKey = activeId
        ? `streamanime_watch_history_${activeId}`
        : "streamanime_watch_history";

      const trackingPayload = {
        anilistId: String(anilistId),
        animeTitle,
        episodeNumber: epNum,
        episodeImage: episodeSnapshot || "https://placehold.co/300x180?text=Episode+Preview",
        currentTime: current,
        duration: total,
        progressPercent: Math.min((current / total) * 100, 100),
        provider,
        category: activeCategory,
        slug: currentSlug,
        mediaType: isExternalMedia ? (isExternalMovie ? "movie" : "tv") : "anime",
        season: seasonNum,
        ...(historySeasonName ? { seasonName: historySeasonName } : {}),
        updatedAt: Date.now(),
      };

      // Start from the CLOUD copy, not this device's local cache
      let baseList: any[] = [];
      if (activeId) {
        try {
          const { data, error } = await supabase
            .from("profiles")
            .select("recent_episodes")
            .eq("id", activeId)
            .single();
          if (!error && Array.isArray(data?.recent_episodes)) baseList = data.recent_episodes;
        } catch {
          // Cloud read failed (offline, etc.) — fall back to local cache
        }
      }
      if (baseList.length === 0) {
        let raw: string | null = null;
        try { raw = localStorage.getItem(storageKey); } catch { raw = null; }
        baseList = raw ? JSON.parse(raw) : [];
      }

      const merged = dedupeHistoryEntriesByTitle([trackingPayload, ...baseList]);
      merged.sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      const optimizedHistorySlice = merged.slice(0, 20);

      try { localStorage.setItem(storageKey, JSON.stringify(optimizedHistorySlice)); } catch {}

      if (activeId) {
        await supabase
          .from("profiles")
          .update({ recent_episodes: optimizedHistorySlice })
          .eq("id", activeId);

        fetch(`${BACKEND_API}/watch-stats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: activeId,
            anilistId,
            title: animeTitle,
            category: activeCategory,
            episodeNumber: epNum,
            progressPercent: Math.min((current / total) * 100, 100),
          }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error("Cloud watch sync workflow failed:", e);
    }
  }, [anilistId, animeTitle, epNum, episodeSnapshot, provider, activeCategory, currentSlug, isExternalMedia, isExternalMovie, seasonNum, historySeasonName]);

  const getSavedResumePosition = useCallback((): number => {
    let initialTime = 0;
    try {
      const activeId = localStorage.getItem("streamanime_active_profile_id");
      const storageKey = activeId
        ? `streamanime_watch_history_${activeId}`
        : "streamanime_watch_history";
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const list = JSON.parse(raw);
        const log = list.find(
          (item: any) =>
            String(item.anilistId) === String(anilistId) &&
            String(item.episodeNumber) === String(epNum) &&
            (!isExternalMedia || isExternalMovie || String(item.season ?? "1") === String(seasonNum))
        );
        if (log && log.currentTime > 5) {
          if (!log.duration || log.duration - log.currentTime > 15) {
            initialTime = log.currentTime;
          }
        }
      }
    } catch {}

    if (initialTime === 0) {
      try {
        const savedResumeTime = localStorage.getItem(getResumeTimeKey(anilistId, epNum));
        if (savedResumeTime) {
          const parsed = parseFloat(savedResumeTime);
          if (parsed > 5) {
            initialTime = parsed;
            localStorage.removeItem(getResumeTimeKey(anilistId, epNum));
          }
        }
      } catch {}
    }

    return initialTime;
  }, [anilistId, epNum, isExternalMedia, isExternalMovie, seasonNum]);

  return {
    progressMap,
    setProgressMap,
    commitPlaybackSessionToStorageLog,
    getSavedResumePosition,
  };
}


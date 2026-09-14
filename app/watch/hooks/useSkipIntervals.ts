import { useState, useRef, useCallback } from "react";
import { SKIP_COUNTDOWN_DURATION } from "../lib/constants";
import { resolveSkipIntervals } from "../../utils/introOutroResolver";
import type { TmdbSeasonInfo, SkipIntervalItem } from "../lib/types";
export type { SkipIntervalItem };

interface UseSkipIntervalsOptions {
  isExternalMedia: boolean;
  isExternalMovie: boolean;
  anilistId: string;
  seasonNum: string;
  epNum: string;
  tmdbShowId: string | null;
  animeTitle: string;
  tmdbSeasons: TmdbSeasonInfo[];
  autoskip: boolean;
  autonext: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  navigateToNextEpisode: () => void;
}

export function useSkipIntervals({
  isExternalMedia,
  isExternalMovie,
  anilistId,
  seasonNum,
  epNum,
  tmdbShowId,
  animeTitle,
  tmdbSeasons,
  autoskip,
  autonext,
  videoRef,
  navigateToNextEpisode,
}: UseSkipIntervalsOptions) {
  const [skipIntervals, setSkipIntervals] = useState<any[]>([]);
  const [currentActiveSkip, setCurrentActiveSkip] = useState<any | null>(null);
  const [showSkipButton, setShowSkipButton] = useState(false);

  const skipTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSkipTypeRef = useRef<"op" | "ed" | null>(null);

  const resetSkipState = useCallback(() => {
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current);
      skipTimerRef.current = null;
    }
    setSkipIntervals([]);
    setCurrentActiveSkip(null);
    setShowSkipButton(false);
    lastSkipTypeRef.current = null;
  }, []);

  const fetchSkipTimestamps = useCallback(async (targetDuration: number) => {
    const kind: "anime" | "movie" | "tv" = isExternalMedia
      ? isExternalMovie
        ? "movie"
        : "tv"
      : "anime";
    const exactSeconds = Math.floor(targetDuration);
    if (isNaN(exactSeconds) || exactSeconds <= 60) return;

    // Map the provider's (often absolute) episode number onto TMDB season/
    // episode numbering when enrichment data exists, so TheIntroDB receives a
    // valid season/episode pair instead of an absolute number.
    let tmdbSeason = Number(seasonNum) || 1;
    let tmdbEpisode = Math.floor(parseFloat(epNum) || 1);
    if (kind === "anime" && tmdbSeasons.length > 0) {
      const epFloat = parseFloat(epNum) || 1;
      const containing = tmdbSeasons.find(
        (s) => epFloat > s.absoluteOffset && epFloat <= s.absoluteOffset + s.episodeCount
      );
      if (containing) {
        tmdbSeason = containing.number;
        tmdbEpisode = Math.floor(epFloat - containing.absoluteOffset);
      }
    }

    const intervals = await resolveSkipIntervals({
      kind,
      tmdbShowId: tmdbShowId || null,
      title: animeTitle && animeTitle !== "Anime Series" ? animeTitle : null,
      anilistId: kind === "anime" ? anilistId : null,
      season: tmdbSeason,
      episode: tmdbEpisode,
      durationSeconds: exactSeconds,
    });
    setSkipIntervals(intervals);
  }, [isExternalMedia, isExternalMovie, anilistId, seasonNum, epNum, tmdbShowId, animeTitle, tmdbSeasons]);

  const checkSkipTime = useCallback((time: number) => {
    const activeBlock = skipIntervals.find(
      (s) => time >= s.interval.startTime && time <= s.interval.endTime
    );

    if (activeBlock) {
      if (autoskip) {
        lastSkipTypeRef.current = null;
        if (videoRef.current) {
          videoRef.current.currentTime = activeBlock.interval.endTime + 0.1;
        }
        setCurrentActiveSkip(null);
        setShowSkipButton(false);
        return;
      }

      if (currentActiveSkip?.skipId !== activeBlock.skipId) {
        setCurrentActiveSkip(activeBlock);
        lastSkipTypeRef.current = activeBlock.skipType;
        setShowSkipButton(true);

        if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
        skipTimerRef.current = setTimeout(() => {
          setShowSkipButton(false);
        }, SKIP_COUNTDOWN_DURATION);
      }
    } else if (lastSkipTypeRef.current === "ed") {
      lastSkipTypeRef.current = null;
      setCurrentActiveSkip(null);
      setShowSkipButton(false);
      if (autonext) {
        navigateToNextEpisode();
      }
    } else {
      if (currentActiveSkip) {
        setCurrentActiveSkip(null);
        setShowSkipButton(false);
        if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
      }
    }
  }, [skipIntervals, autoskip, currentActiveSkip, autonext, videoRef, navigateToNextEpisode]);

  const executeManualSkipSegment = useCallback(() => {
    if (!videoRef.current || !currentActiveSkip) return;

    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    setShowSkipButton(false);

    if (currentActiveSkip.skipType === "ed") {
      lastSkipTypeRef.current = null;
      setCurrentActiveSkip(null);
      navigateToNextEpisode();
    } else {
      lastSkipTypeRef.current = null;
      videoRef.current.currentTime = currentActiveSkip.interval.endTime + 0.1;
      setCurrentActiveSkip(null);
    }
  }, [currentActiveSkip, navigateToNextEpisode, videoRef]);

  return {
    skipIntervals,
    setSkipIntervals,
    currentActiveSkip,
    setCurrentActiveSkip,
    showSkipButton,
    setShowSkipButton,
    skipTimerRef,
    lastSkipTypeRef,
    resetSkipState,
    fetchSkipTimestamps,
    checkSkipTime,
    executeManualSkipSegment,
  };
}

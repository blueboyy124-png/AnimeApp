import { useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { tmdbFetch } from "../../utils/tmdbIdResolver";
import type { EpisodeNode, TmdbSeasonInfo } from "../lib/types";

interface UseEpisodeNavigationOptions {
  episodes: EpisodeNode[];
  epNum: string;
  queryString: string;
  isExternalMedia: boolean;
  isExternalMovie: boolean;
  tmdbShowId: string | null;
  seasonNum: string;
  tmdbSeasons?: TmdbSeasonInfo[];
  savedTimeRef: React.MutableRefObject<number>;
  forceStartFromZeroRef: React.MutableRefObject<boolean>;
}

export function useEpisodeNavigation({
  episodes,
  epNum,
  queryString,
  isExternalMedia,
  isExternalMovie,
  tmdbShowId,
  seasonNum,
  tmdbSeasons = [],
  savedTimeRef,
  forceStartFromZeroRef,
}: UseEpisodeNavigationOptions) {
  const router = useRouter();
  const pathname = usePathname();

  const isNavigatingRef = useRef(false);

  const navigateToNextEpisode = useCallback(async () => {
    if (isNavigatingRef.current) return;
    const currentEpNum = parseFloat(epNum);

    // TV shows number episodes per-season (1..N each season), and the sidebar's
    // season browser can leave the shared `episodes` state pointing at whatever
    // season the person last looked at — not necessarily the one playing. So for
    // TV we resolve the *playing* season's episode list fresh, right here, and
    // roll over into the next season once the current one runs out. Anime never
    // hits this because its episode list is one flat, continuously-numbered run
    // across the whole show.
    if (isExternalMedia && !isExternalMovie && tmdbShowId) {
      isNavigatingRef.current = true;
      try {
        const currentSeasonNum = Number(seasonNum) || 1;
        const { ok, data } = await tmdbFetch(`/tv/${tmdbShowId}/season/${currentSeasonNum}`);
        const seasonEpisodes = ok ? (data?.episodes || []) : [];
        const nextInSeason = seasonEpisodes.find((e: any) => Number(e.episode_number) > currentEpNum);

        let targetSeason = currentSeasonNum;
        let targetEpisode = nextInSeason?.episode_number;

        if (!targetEpisode) {
          targetSeason = currentSeasonNum + 1;
          const { ok: nextOk, data: nextData } = await tmdbFetch(`/tv/${tmdbShowId}/season/${targetSeason}`);
          const nextSeasonEpisodes = nextOk ? (nextData?.episodes || []) : [];
          if (nextSeasonEpisodes.length === 0) {
            isNavigatingRef.current = false;
            return; // genuinely the series finale
          }
          targetEpisode = nextSeasonEpisodes[0].episode_number;
        }

        const p = new URLSearchParams(queryString);
        p.set("epNum", String(targetEpisode));
        p.set("slug", String(targetEpisode));
        p.set("season", String(targetSeason));
        savedTimeRef.current = 0;
        forceStartFromZeroRef.current = true;
        router.push(`${pathname}?${p.toString()}`);
      } catch {
        isNavigatingRef.current = false;
      }
      return;
    }

    const sorted = [...episodes].sort((a, b) => a.number - b.number);
    const nextEp = sorted.find((e) => Number(e.number) > currentEpNum);
    if (!nextEp) return;

    const slug = nextEp.id.includes("/")
      ? nextEp.id.split("/").pop() ?? nextEp.id
      : nextEp.id;

    const p = new URLSearchParams(queryString);
    p.set("epNum", String(nextEp.number));
    p.set("slug", slug);
    savedTimeRef.current = 0;
    forceStartFromZeroRef.current = true;
    isNavigatingRef.current = true;
    router.push(`${pathname}?${p.toString()}`);
  }, [episodes, epNum, queryString, pathname, router, isExternalMedia, isExternalMovie, tmdbShowId, seasonNum, savedTimeRef, forceStartFromZeroRef]);

  const navigateToPrevEpisode = useCallback(async () => {
    if (isNavigatingRef.current) return;
    const currentEpNum = parseFloat(epNum);

    if (isExternalMedia && !isExternalMovie && tmdbShowId) {
      isNavigatingRef.current = true;
      try {
        const currentSeasonNum = Number(seasonNum) || 1;
        const { ok, data } = await tmdbFetch(`/tv/${tmdbShowId}/season/${currentSeasonNum}`);
        const seasonEpisodes = ok ? (data?.episodes || []) : [];
        const prevInSeason = [...seasonEpisodes]
          .sort((a: any, b: any) => b.episode_number - a.episode_number)
          .find((e: any) => Number(e.episode_number) < currentEpNum);

        let targetSeason = currentSeasonNum;
        let targetEpisode = prevInSeason?.episode_number;

        if (!targetEpisode) {
          targetSeason = currentSeasonNum - 1;
          if (targetSeason < 1) {
            isNavigatingRef.current = false;
            return; // genuinely the series premiere
          }
          const { ok: prevOk, data: prevData } = await tmdbFetch(`/tv/${tmdbShowId}/season/${targetSeason}`);
          const prevSeasonEpisodes = prevOk ? (prevData?.episodes || []) : [];
          if (prevSeasonEpisodes.length === 0) {
            isNavigatingRef.current = false;
            return;
          }
          targetEpisode = prevSeasonEpisodes[prevSeasonEpisodes.length - 1].episode_number;
        }

        const p = new URLSearchParams(queryString);
        p.set("epNum", String(targetEpisode));
        p.set("slug", String(targetEpisode));
        p.set("season", String(targetSeason));
        savedTimeRef.current = 0;
        forceStartFromZeroRef.current = true;
        router.push(`${pathname}?${p.toString()}`);
      } catch {
        isNavigatingRef.current = false;
      }
      return;
    }

    const sorted = [...episodes].sort((a, b) => b.number - a.number);
    const prevEp = sorted.find((e) => Number(e.number) < currentEpNum);
    if (!prevEp) return;

    const slug = prevEp.id.includes("/")
      ? prevEp.id.split("/").pop() ?? prevEp.id
      : prevEp.id;

    const p = new URLSearchParams(queryString);
    p.set("epNum", String(prevEp.number));
    p.set("slug", slug);
    savedTimeRef.current = 0;
    forceStartFromZeroRef.current = true;
    isNavigatingRef.current = true;
    router.push(`${pathname}?${p.toString()}`);
  }, [episodes, epNum, queryString, pathname, router, isExternalMedia, isExternalMovie, tmdbShowId, seasonNum, savedTimeRef, forceStartFromZeroRef]);

  const parsedEpNum = parseFloat(epNum);
  const currentSeasonNumForNav = Number(seasonNum) || 1;
  const currentSeasonInfoForNav = tmdbSeasons.find((s) => s.number === currentSeasonNumForNav);

  const hasPrevEpisode =
    isExternalMedia && !isExternalMovie
      ? parsedEpNum > 1 || tmdbSeasons.some((s) => s.number === currentSeasonNumForNav - 1)
      : episodes.some((e) => Number(e.number) < parsedEpNum);

  const hasNextEpisodeElement =
    isExternalMedia && !isExternalMovie
      ? (currentSeasonInfoForNav ? parsedEpNum < currentSeasonInfoForNav.episodeCount : true) ||
        tmdbSeasons.some((s) => s.number === currentSeasonNumForNav + 1)
      : episodes.some((e) => Number(e.number) > parsedEpNum);

  return {
    navigateToNextEpisode,
    navigateToPrevEpisode,
    isNavigatingRef,
    hasPrevEpisode,
    hasNextEpisodeElement,
  };
}

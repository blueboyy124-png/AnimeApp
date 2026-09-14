import { useEffect } from "react";
import { TMDB_ENRICHMENT_DISABLED_ANILIST_IDS, TMDB_IMG } from "../lib/constants";
import { tmdbFetch, resolveTmdbId, mapTmdbSeasons } from "../../utils/tmdbIdResolver";
import type { TmdbSeasonInfo, TmdbEpisodeMeta } from "../lib/types";

// ---- TMDB metadata enrichment (anime titles only) --------------------------
// Real season structure + episode art/synopses layered on top of the
// provider's absolute episode numbering.

interface UseTmdbEnrichmentOptions {
  isExternalMedia: boolean;
  anilistId: string;
  animeTitle: string;
  episodesLength: number;
  epNum: string;
  tmdbShowId: string | null;
  setTmdbShowId: (id: string | null) => void;
  tmdbSeasons: TmdbSeasonInfo[];
  setTmdbSeasons: (s: TmdbSeasonInfo[]) => void;
  selectedTmdbSeason: number;
  setSelectedTmdbSeason: (s: number) => void;
  setTmdbSeasonLoading: (l: boolean) => void;
  setTmdbEpisodeMeta: React.Dispatch<React.SetStateAction<Record<number, TmdbEpisodeMeta>>>;
}

export function useTmdbEnrichment({
  isExternalMedia,
  anilistId,
  animeTitle,
  episodesLength,
  epNum,
  tmdbShowId,
  setTmdbShowId,
  tmdbSeasons,
  setTmdbSeasons,
  selectedTmdbSeason,
  setSelectedTmdbSeason,
  setTmdbSeasonLoading,
  setTmdbEpisodeMeta,
}: UseTmdbEnrichmentOptions) {
  // Resolve TMDB seasons for anime titles
  useEffect(() => {
    if (isExternalMedia) return;
    if (!animeTitle || animeTitle === "Anime Series") return;
    if (episodesLength === 0) return;
    if (TMDB_ENRICHMENT_DISABLED_ANILIST_IDS.has(anilistId)) return;

    let cancelled = false;

    async function resolveTmdbSeasons() {
      try {
        const resolved = await resolveTmdbId({ kind: "anime", title: animeTitle, anilistId });
        if (!resolved || cancelled) return;

        const { ok: showOk, data: showData } = await tmdbFetch(`/tv/${resolved.tmdbId}`);
        if (!showOk || cancelled || !showData) return;

        const mapped: TmdbSeasonInfo[] = mapTmdbSeasons(showData.seasons || []);
        if (mapped.length === 0) return;

        if (cancelled) return;
        setTmdbShowId(resolved.tmdbId);
        setTmdbSeasons(mapped);

        // Default to whichever season contains the episode currently being watched.
        const epFloat = parseFloat(epNum) || 1;
        const containing = mapped.find(
          (s) => epFloat > s.absoluteOffset && epFloat <= s.absoluteOffset + s.episodeCount
        );
        setSelectedTmdbSeason((containing || mapped[0]).number);
      } catch {
        // TMDB enrichment is optional polish — fail silently and keep provider-only data.
      }
    }

    resolveTmdbSeasons();
    return () => {
      cancelled = true;
    };
  }, [isExternalMedia, anilistId, animeTitle, episodesLength, epNum, setTmdbShowId, setTmdbSeasons, setSelectedTmdbSeason]);

  // Fetch episode-level metadata for the selected TMDB season
  useEffect(() => {
    if (isExternalMedia) return;
    if (!tmdbShowId || tmdbSeasons.length === 0) return;
    if (TMDB_ENRICHMENT_DISABLED_ANILIST_IDS.has(anilistId)) return;

    let cancelled = false;
    async function loadSeasonEpisodes() {
      setTmdbSeasonLoading(true);
      try {
        const season = tmdbSeasons.find((s) => s.number === selectedTmdbSeason);
        if (!season) return;
        const { ok, data } = await tmdbFetch(`/tv/${tmdbShowId}/season/${selectedTmdbSeason}`);
        if (!ok || cancelled) return;
        const eps = Array.isArray(data?.episodes) ? data.episodes : [];
        const metaByAbsolute: Record<number, TmdbEpisodeMeta> = {};
        eps.forEach((ep: any) => {
          const absoluteNumber = season.absoluteOffset + ep.episode_number;
          metaByAbsolute[absoluteNumber] = {
            title: ep.name,
            description: ep.overview,
            image: ep.still_path ? `${TMDB_IMG}/w300${ep.still_path}` : undefined,
            runtimeMinutes: typeof ep.runtime === "number" ? ep.runtime : undefined,
          };
        });
        if (!cancelled) setTmdbEpisodeMeta(metaByAbsolute);
      } catch {
        // optional polish only
      } finally {
        if (!cancelled) setTmdbSeasonLoading(false);
      }
    }

    loadSeasonEpisodes();
    return () => {
      cancelled = true;
    };
  }, [isExternalMedia, anilistId, tmdbShowId, tmdbSeasons, selectedTmdbSeason, setTmdbSeasonLoading, setTmdbEpisodeMeta]);
}

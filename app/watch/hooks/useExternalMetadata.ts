import { useEffect } from "react";
import { TMDB_API_KEY, TMDB_IMG } from "../../utils/tmdbIdResolver";
import type { EpisodeNode, TmdbSeasonInfo } from "../lib/types";

interface UseExternalMetadataOptions {
  isExternalMedia: boolean;
  isExternalMovie: boolean;
  anilistId: string;
  seasonNum: string;
  epNum: string;
  setAnimeTitle: (t: string) => void;
  setEpisodeTitle: React.Dispatch<React.SetStateAction<string>>;
  setEpisodeDesc: (d: string) => void;
  setEpisodeSnapshot: (s: string) => void;
  setMediaAirDate: (d: string) => void;
  setWatchProviders: (p: Array<{ name: string; type: string }>) => void;
  setEpisodes: (e: EpisodeNode[]) => void;
  tmdbShowId: string | null;
  setTmdbShowId: (id: string | null) => void;
  setTmdbSeasons: (s: TmdbSeasonInfo[]) => void;
  selectedTmdbSeason: number;
  setSelectedTmdbSeason: (s: number) => void;
  setTmdbSeasonLoading: (l: boolean) => void;
}

export function useExternalMetadata({
  isExternalMedia,
  isExternalMovie,
  anilistId,
  seasonNum,
  epNum,
  setAnimeTitle,
  setEpisodeTitle,
  setEpisodeDesc,
  setEpisodeSnapshot,
  setMediaAirDate,
  setWatchProviders,
  setEpisodes,
  tmdbShowId,
  setTmdbShowId,
  setTmdbSeasons,
  selectedTmdbSeason,
  setSelectedTmdbSeason,
  setTmdbSeasonLoading,
}: UseExternalMetadataOptions) {
  // --- MOVIE/TV METADATA (title, overview, episode list, legal watch providers) ---
  useEffect(() => {
    if (!isExternalMedia) return;

    const tmdbId = anilistId.replace(/^tmdb-(?:movie|tv)-/i, "");
    if (!/^\d+$/.test(tmdbId)) return;

    let cancelled = false;

    async function fetchLegalProviders(title: string) {
      try {
        const res = await fetch(`/api/justwatch?query=${encodeURIComponent(title)}`);
        if (!res.ok) return;
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : data?.results ? [data.results] : [];
        const match = results.find((r: any) => r.title?.toLowerCase() === title.toLowerCase()) || results[0];
        const offers = match?.offers || [];
        const dedup = new Map<string, { name: string; type: string }>();
        for (const o of offers) {
          if (o?.provider && !dedup.has(o.provider)) {
            dedup.set(o.provider, { name: o.provider, type: o.monetizationType || "" });
          }
        }
        if (!cancelled) setWatchProviders(Array.from(dedup.values()));
      } catch {
        // Non-critical — just skip the legal-provider badges if JustWatch lookup fails.
      }
    }

    async function fetchMetadata() {
      if (!TMDB_API_KEY) {
        console.warn("NEXT_PUBLIC_TMDB_API_KEY is not set — skipping title/episode metadata fetch.");
        return;
      }

      try {
        if (isExternalMovie) {
          const res = await fetch(
            `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`
          );
          if (!res.ok || cancelled) return;
          const data = await res.json();
          if (cancelled) return;

          setAnimeTitle(data.title || "Movie");
          setEpisodeTitle(data.title || "Movie");
          setEpisodeDesc(data.overview || "");
          setMediaAirDate(data.release_date || "");
          if (data.poster_path) setEpisodeSnapshot(`${TMDB_IMG}/w500${data.poster_path}`);
          setEpisodes([]);

          if (data.title) fetchLegalProviders(data.title);
        } else {
          const showRes = await fetch(
            `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`
          );
          if (!showRes.ok || cancelled) return;
          const showData = await showRes.json();
          if (cancelled) return;

          setAnimeTitle(showData.name || "TV Show");
          if (showData.name) fetchLegalProviders(showData.name);

          const rawSeasons = Array.isArray(showData.seasons) ? showData.seasons : [];
          const realSeasons = rawSeasons
            .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
            .sort((a: any, b: any) => a.season_number - b.season_number);
          if (!cancelled && realSeasons.length > 0) {
            const mapped: TmdbSeasonInfo[] = realSeasons.map((s: any) => ({
              number: s.season_number,
              name: s.name || `Season ${s.season_number}`,
              poster: s.poster_path ? `${TMDB_IMG}/w400${s.poster_path}` : undefined,
              episodeCount: s.episode_count,
              absoluteOffset: 0,
            }));
            setTmdbShowId(tmdbId);
            setTmdbSeasons(mapped);
            setSelectedTmdbSeason(Number(seasonNum) || mapped[0].number);
          }
        }
      } catch (err) {
        console.error("Failed to fetch movie/TV metadata:", err);
      }
    }

    fetchMetadata();
    return () => {
      cancelled = true;
    };
  }, [isExternalMedia, isExternalMovie, anilistId, seasonNum, setAnimeTitle, setEpisodeTitle, setEpisodeDesc, setMediaAirDate, setEpisodeSnapshot, setEpisodes, setWatchProviders, setTmdbShowId, setTmdbSeasons, setSelectedTmdbSeason]);

  // --- EXTERNAL TV: EPISODE LIST FOR WHICHEVER SEASON IS SELECTED ---
  useEffect(() => {
    if (!isExternalMedia || isExternalMovie) return;
    if (!tmdbShowId) return;

    let cancelled = false;

    async function fetchSeasonEpisodes() {
      setTmdbSeasonLoading(true);
      try {
        const seasonRes = await fetch(
          `https://api.themoviedb.org/3/tv/${tmdbShowId}/season/${selectedTmdbSeason}?api_key=${TMDB_API_KEY}&language=en-US`
        );
        if (!seasonRes.ok || cancelled) return;
        const seasonData = await seasonRes.json();
        if (cancelled) return;

        const episodeList: EpisodeNode[] = (seasonData.episodes || []).map((ep: any) => ({
          id: String(ep.episode_number),
          number: ep.episode_number,
          title: ep.name,
          description: ep.overview,
          image: ep.still_path ? `${TMDB_IMG}/w300${ep.still_path}` : undefined,
          slug: String(ep.episode_number),
        }));
        if (cancelled) return;
        setEpisodes(episodeList);

        if (selectedTmdbSeason === (Number(seasonNum) || 1)) {
          const currentEp = episodeList.find((e) => Number(e.number) === parseFloat(epNum));
          if (currentEp) {
            setEpisodeTitle(currentEp.title || `Episode ${currentEp.number}`);
            setEpisodeDesc(currentEp.description || "");
            if (currentEp.image) setEpisodeSnapshot(currentEp.image);
            const rawEp = (seasonData.episodes || []).find((e: any) => e.episode_number === currentEp.number);
            if (rawEp?.air_date) setMediaAirDate(rawEp.air_date);
          }
        }
      } catch (err) {
        console.error("Failed to fetch season episode list:", err);
      } finally {
        if (!cancelled) setTmdbSeasonLoading(false);
      }
    }

    fetchSeasonEpisodes();
    return () => {
      cancelled = true;
    };
  }, [isExternalMedia, isExternalMovie, tmdbShowId, selectedTmdbSeason, seasonNum, epNum, setTmdbSeasonLoading, setEpisodes, setEpisodeTitle, setEpisodeDesc, setEpisodeSnapshot, setMediaAirDate]);
}


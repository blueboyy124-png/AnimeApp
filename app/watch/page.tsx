"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import TopBar from "../components/TopBar";
import { supabase } from "../utils/supabase";

import WatchPlayer from "./components/WatchPlayer";
import EpisodeInfo from "./components/EpisodeInfo";
import Sidebar from "./components/Sidebar";
import { RecommendationsRow } from "./components/RecommendationsRow";

import { useWatchRoute } from "./hooks/useWatchRoute";
import { useWatchProgress } from "./hooks/useWatchProgress";
import { usePlayback } from "./hooks/usePlayback";
import { useTmdbEnrichment } from "./hooks/useTmdbEnrichment";
import { useExternalMetadata } from "./hooks/useExternalMetadata";
import { useEpisodeNavigation } from "./hooks/useEpisodeNavigation";
import { useSkipIntervals } from "./hooks/useSkipIntervals";
import { useWatchDownload } from "./hooks/useWatchDownload";
import { useAnimeStream } from "./hooks/useAnimeStream";
import { useExternalStream } from "./hooks/useExternalStream";

import {
  loadSourceCache,
  saveSourceCache,
  loadPersistentSourceCache,
  savePersistentSourceCache,
} from "./lib/sourceCache";
import { formatTime } from "./lib/utils";
import { CONTINUE_WATCHING_THRESHOLD } from "./lib/constants";
import type { EpisodeNode, TmdbSeasonInfo, TmdbEpisodeMeta } from "./lib/types";

function WatchContent() {
  const router = useRouter();
  const pathname = usePathname();

  // Route & Parameters
  const {
    provider,
    mediaType,
    anilistId,
    activeCategory,
    currentSlug,
    epNum,
    seasonNum,
    queryString,
    isExternalMedia,
    isExternalMovie,
    handleCategoryChange,
    handleProviderChange,
  } = useWatchRoute();

  // Streaming & Pipeline Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<any | null>(null);
  const playbackGenerationRef = useRef<number>(0);
  const playbackHasStartedRef = useRef<boolean>(false);
  const playbackSourceReadyRef = useRef<boolean>(false);
  const activeSourceUrlRef = useRef<string | null>(null);
  const sourceAttemptRef = useRef<number>(0);
  const sourceStateRef = useRef<"idle" | "pending" | "healthy" | "failed">("idle");
  const stallRecoveryTimerRef = useRef<number | null>(null);
  const streamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mediaProgressHandlerRef = useRef<(() => void) | null>(null);
  const mediaSuccessHandlerRef = useRef<(() => void) | null>(null);
  const mediaFailureHandlerRef = useRef<(() => void) | null>(null);
  const savedTimeRef = useRef<number>(0);
  const forceStartFromZeroRef = useRef<boolean>(false);
  const episodesCacheRef = useRef<{ id: string; data: any } | null>(null);
  const seasonListRef = useRef<HTMLDivElement | null>(null);
  const episodeListRef = useRef<HTMLDivElement | null>(null);
  const activeRouteIdentityRef = useRef<string>("");
  const previousMediaIdentityRef = useRef<string>("");


  // Unified Media & Player State
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Initializing player...");
  const [error, setError] = useState<string | null>(null);
  const [playbackHasStarted, setPlaybackHasStarted] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"episodes" | "seasons" | "related">("episodes");
  const [episodeInfoExpanded, setEpisodeInfoExpanded] = useState(true);
  const [currentProfile, setCurrentProfile] = useState<any>(null);

  const [animeTitle, setAnimeTitle] = useState<string>(
    isExternalMovie ? "Movie" : isExternalMedia ? "TV Show" : "Anime Series"
  );
  const [episodeTitle, setEpisodeTitle] = useState<string>(
    isExternalMovie ? "Full Feature Film" : `Episode ${epNum}`
  );
  const [episodeDesc, setEpisodeDesc] = useState<string>("");
  const [episodeSnapshot, setEpisodeSnapshot] = useState<string>("");
  const [mediaAirDate, setMediaAirDate] = useState<string>("");
  const [watchProviders, setWatchProviders] = useState<Array<{ name: string; type: string }>>([]);
  const [episodes, setEpisodes] = useState<EpisodeNode[]>([]);
  const [tmdbShowId, setTmdbShowId] = useState<string | null>(null);
  const [tmdbSeasons, setTmdbSeasons] = useState<TmdbSeasonInfo[]>([]);
  const [selectedTmdbSeason, setSelectedTmdbSeason] = useState<number>(Number(seasonNum) || 1);
  const [tmdbSeasonLoading, setTmdbSeasonLoading] = useState<boolean>(false);
  const [tmdbEpisodeMeta, setTmdbEpisodeMeta] = useState<Record<number, TmdbEpisodeMeta>>({});
  const [subSlug, setSubSlug] = useState<string | null>(null);
  const [dubSlug, setDubSlug] = useState<string | null>(null);
  const [hasDubAvailable, setHasDubAvailable] = useState<boolean>(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [externalStreamUrl, setExternalStreamUrl] = useState<string | null>(null);
  const [relatedAnime, setRelatedAnime] = useState<any[]>([]);

  // Active Profile on Mount
  useEffect(() => {
    try {
      const activeId = localStorage.getItem("streamanime_active_profile_id");
      const savedProfiles = localStorage.getItem("streamanime_profiles");
      if (activeId && savedProfiles) {
        const list = JSON.parse(savedProfiles);
        const p = list.find((item: any) => item.id === activeId);
        if (p) setCurrentProfile(p);
      }
    } catch {}
  }, []);

  const handleSignOutAction = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem("streamanime_active_profile_id");
      router.push("/login");
    } catch {
      router.push("/login");
    }
  }, [router]);

  // Watch Progress & History
  const { progressMap, commitPlaybackSessionToStorageLog } = useWatchProgress({
    anilistId,
    animeTitle,
    epNum,
    seasonNum,
    episodeSnapshot,
    provider,
    activeCategory,
    currentSlug,
    isExternalMedia,
    isExternalMovie,
  });

  // Episode Navigation
  const {
    navigateToNextEpisode,
    navigateToPrevEpisode,
    isNavigatingRef,
    hasPrevEpisode,
    hasNextEpisodeElement,
  } = useEpisodeNavigation({
    episodes,
    epNum,
    queryString,
    isExternalMedia,
    isExternalMovie,
    tmdbShowId,
    seasonNum,
    tmdbSeasons,
    savedTimeRef,
    forceStartFromZeroRef,
  });

  // Playback Engine — must come before useSkipIntervals so autoskip/autonext are available
  const checkSkipTimeRef = useRef<((time: number) => void) | null>(null);
  const {
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    bufferedPercent,
    setBufferedPercent,
    volume,
    isMuted,
    isFullscreen,
    showControls,
    captionsEnabled,
    subtitleTracks,
    setSubtitleTracks,
    currentCaption,
    setCurrentCaption,
    playbackRate,
    videoQuality,
    setVideoQuality,
    seekFlash,
    setSeekFlash,
    isPiPActive,
    isCropFill,
    showSettingsMenu,
    setShowSettingsMenu,
    showVolumeSlider,
    autoplay,
    autoskip,
    autonext,
    settingsMenuRef,
    volumeControlRef,
    triggerControlsActivity,
    togglePlay,
    handleVideoClick,
    skipSeconds,
    handleScrub,
    applyCaptionMode,
    setVolumeLevel,
    toggleMute,
    togglePictureInPicture,
    applyPlaybackRate,
    toggleFullscreen,
    revealVolumeSlider,
    scheduleHideVolumeSlider,
    toggleAutoplayState,
    toggleAutoskipState,
    toggleAutonextState,
    toggleCropFill,
    handleTimeUpdate,
  } = usePlayback({
    videoRef,
    playerContainerRef,
    setLoading,
    setStatus,
    setError,
    onTimeUpdateCallback: (time, totalDuration) => {
      if (totalDuration > 0 && isFinite(time)) {
        commitPlaybackSessionToStorageLog(time, totalDuration);
      }
    },
    onSkipCheck: (time) => {
      checkSkipTimeRef.current?.(time);
    },
  });

  // Skip Intervals (Intro/Outro) — needs autoskip/autonext from usePlayback
  const {
    skipIntervals,
    currentActiveSkip,
    showSkipButton,
    resetSkipState,
    fetchSkipTimestamps,
    checkSkipTime,
    executeManualSkipSegment,
  } = useSkipIntervals({
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
  });
  // Wire checkSkipTime into the ref so the playback callback above can invoke it
  checkSkipTimeRef.current = checkSkipTime;


  // Offline Downloads
  const { downloadProgress, downloadedFlag, handleDownload } = useWatchDownload({
    anilistId,
    epNum,
    seasonNum,
    currentSlug,
    animeTitle,
    episodeSnapshot,
    activeCategory,
    provider,
    isExternalMedia,
    isExternalMovie,
    setError,
  });

  // TMDB Enrichment for Anime
  useTmdbEnrichment({
    isExternalMedia,
    anilistId,
    animeTitle,
    episodesLength: episodes.length,
    epNum,
    tmdbShowId,
    setTmdbShowId,
    tmdbSeasons,
    setTmdbSeasons,
    selectedTmdbSeason,
    setSelectedTmdbSeason,
    setTmdbSeasonLoading,
    setTmdbEpisodeMeta,
  });

  // External Movie/TV Metadata
  useExternalMetadata({
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
  });

  // Destroy HLS lifecycle helper
  const destroyHls = useCallback(() => {
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
    if (hlsRef.current) {
      try {
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
      } catch {}
      hlsRef.current = null;
    }
    mediaFailureHandlerRef.current = null;
    mediaSuccessHandlerRef.current = null;
    mediaProgressHandlerRef.current = null;
    sourceAttemptRef.current += 1;
    sourceStateRef.current = "idle";
    activeSourceUrlRef.current = null;
    playbackSourceReadyRef.current = false;
    if (stallRecoveryTimerRef.current) {
      window.clearTimeout(stallRecoveryTimerRef.current);
      stallRecoveryTimerRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.onerror = null;
        videoRef.current.onloadedmetadata = null;
        videoRef.current.src = "";
        videoRef.current.load();
      } catch {}
    }
  }, []);

  // Compute route / media identity strings (used by both stream hooks and reset effect)
  const mediaIdentity = `${isExternalMedia ? "external" : "anime"}:${mediaType}:${anilistId}`;
  const routeIdentity = `${mediaIdentity}:${seasonNum}:${epNum}:${provider}:${activeCategory}:${currentSlug}`;
  // Keep the ref in sync every render so the stream hooks can compare it synchronously
  activeRouteIdentityRef.current = routeIdentity;

  // ── Route-transition boundary ──────────────────────────────────────────
  // Resets transient player values on every route change. This effect MUST be
  // registered BEFORE the stream pipeline hooks below: the pipelines snapshot
  // playbackGenerationRef.current on entry and abort as "stale" on every await
  // if the generation ever differs. When this effect ran after them (as it did
  // after the big page.tsx → hooks/components refactor), the generation bump
  // happened after the snapshot, so every fresh load self-aborted before
  // episodes/sources ever loaded. Ordering here mirrors the original monolithic
  // page (reset effect → pipeline hooks).
  useEffect(() => {
    const mediaChanged = previousMediaIdentityRef.current !== mediaIdentity;
    previousMediaIdentityRef.current = mediaIdentity;
    playbackGenerationRef.current += 1;

    savedTimeRef.current = 0;
    forceStartFromZeroRef.current = false;
    isNavigatingRef.current = false;
    destroyHls();
    resetSkipState();

    setIsPlaying(false);
    playbackHasStartedRef.current = false;
    setPlaybackHasStarted(false);
    setLoading(true);
    setError(null);
    setStatus("Loading current route...");
    setExternalStreamUrl(null);
    setSubtitleTracks([]);
    setCurrentCaption("");
    setCurrentTime(0);
    setDuration(0);
    setBufferedPercent(0);
    setVideoQuality("Auto");
    setEpisodeTitle(isExternalMovie ? "Full Feature Film" : `Episode ${epNum}`);
    setEpisodeDesc("");
    setEpisodeSnapshot("");
    setMediaAirDate("");

    if (mediaChanged) {
      episodesCacheRef.current = null;
      setEpisodes([]);
      setSubSlug(null);
      setDubSlug(null);
      setHasDubAvailable(false);
      setAvailableProviders([]);
      setTmdbShowId(null);
      setTmdbSeasons([]);
      setSelectedTmdbSeason(Number(seasonNum) || 1);
      setTmdbSeasonLoading(false);
      setTmdbEpisodeMeta({});
      setWatchProviders([]);
      setAnimeTitle(isExternalMovie ? "Movie" : isExternalMedia ? "TV Show" : "Anime Series");
    }
  }, [
    routeIdentity,
    mediaIdentity,
    isExternalMedia,
    isExternalMovie,
    destroyHls,
    epNum,
    isNavigatingRef,
    resetSkipState,
    seasonNum,
    setBufferedPercent,
    setCurrentCaption,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setLoading,
    setSubtitleTracks,
    setVideoQuality,
  ]);

  // Anime Stream Pipeline Hook
  useAnimeStream({
    isExternalMedia,
    anilistId,
    epNum,
    seasonNum,
    activeCategory,
    provider,
    currentSlug,
    mediaType,
    routeIdentity,
    activeRouteIdentityRef,
    playbackGenerationRef,
    sourceAttemptRef,
    sourceStateRef,
    activeSourceUrlRef,
    playbackHasStartedRef,
    playbackSourceReadyRef,
    mediaFailureHandlerRef,
    mediaSuccessHandlerRef,
    mediaProgressHandlerRef,
    streamTimeoutRef,
    stallRecoveryTimerRef,
    savedTimeRef,
    forceStartFromZeroRef,
    episodesCacheRef,
    videoRef,
    hlsRef,
    destroyHls,
    setLoading,
    setError,
    setStatus,
    setAvailableProviders,
    setEpisodes,
    setSubSlug,
    setDubSlug,
    setHasDubAvailable,
    setEpisodeSnapshot,
    setEpisodeTitle,
    setEpisodeDesc,
    setAnimeTitle,
    setSubtitleTracks,
    setVideoQuality,
    resetSkipState,
    autoplay,
    captionsEnabled,
    pathname,
    router,
    queryString,
  });

  // External Movie/TV Stream Pipeline Hook
  useExternalStream({
    isExternalMedia,
    isExternalMovie,
    anilistId,
    epNum,
    seasonNum,
    activeCategory,
    provider,
    currentSlug,
    mediaType,
    routeIdentity,
    activeRouteIdentityRef,
    playbackGenerationRef,
    sourceAttemptRef,
    sourceStateRef,
    activeSourceUrlRef,
    playbackHasStartedRef,
    playbackSourceReadyRef,
    mediaFailureHandlerRef,
    mediaSuccessHandlerRef,
    mediaProgressHandlerRef,
    streamTimeoutRef,
    stallRecoveryTimerRef,
    savedTimeRef,
    forceStartFromZeroRef,
    videoRef,
    hlsRef,
    destroyHls,
    setLoading,
    setError,
    setStatus,
    setExternalStreamUrl,
    setAvailableProviders,
    setEpisodeTitle,
    setVideoQuality,
    resetSkipState,
    autoplay,
    pathname,
    router,
    queryString,
  });

  useEffect(() => {
    return () => {
      destroyHls();
      resetSkipState();
    };
  }, [destroyHls, resetSkipState]);

  // Sidebar Seasons & Episodes Resolution
  const activeTmdbSeasonInfo = tmdbSeasons.find((s) => s.number === selectedTmdbSeason);

  const episodesInSeason = isExternalMedia
    ? episodes
    : activeTmdbSeasonInfo
    ? episodes.filter(
        (e) =>
          Number(e.number) > activeTmdbSeasonInfo.absoluteOffset &&
          Number(e.number) <= activeTmdbSeasonInfo.absoluteOffset + activeTmdbSeasonInfo.episodeCount
      )
    : episodes;

  const displayEpisodes: EpisodeNode[] = episodesInSeason.map((e) => {
    const meta = tmdbEpisodeMeta[Number(e.number)];
    if (!meta) return e;
    return {
      ...e,
      title: meta.title || e.title,
      description: meta.description || e.description,
      image: meta.image || e.image,
      runtimeMinutes: meta.runtimeMinutes ?? e.runtimeMinutes,
    };
  });

  const totalEpisodesCount = displayEpisodes.length;
  const currentDisplayedEpisodes = displayEpisodes;

  // Fetch related anime for "More Like This" section
  useEffect(() => {
    if (!anilistId || isExternalMedia) return;
    let cancelled = false;
    const fetchRelated = async () => {
      try {
        const res = await fetch(`/api/anime/${anilistId}/relations`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const relations = data?.relations || data?.related || data || [];
        setRelatedAnime(Array.isArray(relations) ? relations.slice(0, 12) : []);
      } catch {
        // Non-fatal — recommendations are optional
      }
    };
    fetchRelated();
    return () => { cancelled = true; };
  }, [anilistId, isExternalMedia]);

  // Auto-scroll the season strip
  useEffect(() => {
    if (!seasonListRef.current || tmdbSeasons.length === 0) return;
    const el = seasonListRef.current.querySelector<HTMLElement>(
      `[data-season-number="${selectedTmdbSeason}"]`
    );
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedTmdbSeason, tmdbSeasons.length]);

  // Auto-scroll the episode grid
  useEffect(() => {
    if (!episodeListRef.current || tmdbSeasonLoading || currentDisplayedEpisodes.length === 0) return;
    const el = episodeListRef.current.querySelector<HTMLElement>(
      `[data-episode-number="${epNum}"]`
    );
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    });
    return () => cancelAnimationFrame(raf);
  }, [epNum, tmdbSeasonLoading, currentDisplayedEpisodes.length]);

  // Retry Callback
  const onRetryEpisode = useCallback(() => {
    const retryIdentity = `${anilistId}:${seasonNum || "1"}:${epNum}:${activeCategory}`;
    const sessionCache = loadSourceCache();
    Object.keys(sessionCache).forEach((key) => {
      if (key.includes(retryIdentity)) delete sessionCache[key];
    });
    saveSourceCache(sessionCache);
    const persistentCache = loadPersistentSourceCache();
    Object.keys(persistentCache).forEach((key) => {
      if (key.includes(retryIdentity)) delete persistentCache[key];
    });
    savePersistentSourceCache(persistentCache);
    const retryParams = new URLSearchParams(queryString);
    retryParams.set("retry", String(Date.now()));
    router.replace(`${pathname}?${retryParams.toString()}`);
  }, [anilistId, seasonNum, epNum, activeCategory, queryString, pathname, router]);

  // Category & Provider Change Actions
  const onCategoryChange = useCallback(
    (cat: "sub" | "dub") => {
      handleCategoryChange(cat, {
        subSlug,
        dubSlug,
        videoElement: videoRef.current,
        savedTimeRef,
        destroyHls,
        setLoading,
        setIsPlaying,
      });
    },
    [handleCategoryChange, subSlug, dubSlug, destroyHls, setIsPlaying]
  );

  const onProviderChange = useCallback(
    (prov: string) => {
      handleProviderChange(prov, {
        videoElement: videoRef.current,
        savedTimeRef,
        destroyHls,
        setLoading,
        setIsPlaying,
      });
    },
    [handleProviderChange, destroyHls, setIsPlaying]
  );

  // Derive "More Like This" recommendations from related anime data
  const moreLikeThisItems = useMemo(() => {
    if (!relatedAnime || relatedAnime.length === 0) return [];
    return relatedAnime.map((rel: any) => {
      const title = rel.title?.english || rel.title?.romaji || rel.title?.userPreferred || "Untitled";
      const coverImage = rel.coverImage?.extraLarge || rel.coverImage?.large || rel.coverImage?.medium || rel.coverImage || "";
      return {
        id: rel.id,
        title,
        image: coverImage || "https://images.unsplash.com/photo-1574375927938-d5a98e8edd86?q=80&w=500&auto=format&fit=crop",
        href: `/watch?provider=${provider}&anilistId=${rel.id}&category=${activeCategory}&slug=${encodeURIComponent(rel.title?.english || rel.title?.romaji || "")}&epNum=1`,
        subtitle: rel.format || rel.type || undefined,
      };
    });
  }, [relatedAnime, provider, activeCategory]);

  return (
    <main className="min-h-screen bg-black text-neutral-100 font-sans pb-24 selection:bg-orange-500 selection:text-white">
      <style dangerouslySetInnerHTML={{__html: `
        /* Slider styling */
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 14px;
          width: 14px;
          border-radius: 50%;
          background: #f97316;
          border: 2px solid rgba(255,255,255,0.95);
          box-shadow: 0 0 0 3px rgba(249,115,22,0.2);
          cursor: pointer;
        }
        input[type=range]::-moz-range-thumb {
          height: 14px;
          width: 14px;
          border-radius: 50%;
          background: #f97316;
          border: 2px solid rgba(255,255,255,0.95);
          box-shadow: 0 0 0 3px rgba(249,115,22,0.2);
          cursor: pointer;
        }
        /* Seek bar: kill the native track so only our custom progress divs show —
           without this, mobile browsers render their own white/blue track under it. */
        input[type=range].seek-bar-input {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
        }
        input[type=range].seek-bar-input::-webkit-slider-runnable-track {
          background: transparent;
          border: none;
          box-shadow: none;
        }
        input[type=range].seek-bar-input::-moz-range-track {
          background: transparent;
          border: none;
          box-shadow: none;
        }
        input[type=range].seek-bar-input::-moz-range-progress {
          background: transparent;
        }
      `}} />

      <TopBar
        navItems={[
          { key: "home", label: "Home", href: "/" },
          { key: "upcoming", label: "Upcoming", href: "/?feed=upcoming" },
          { key: "recommendations", label: "Recommendations", href: "/?feed=recommendations" },
          { key: "popular", label: "Popular", href: "/?feed=popular" },
        ]}
        searchMode="redirect"
        searchPlaceholder="Search titles, genres..."
        onSearchTrigger={() => router.push("/")}
        profileMode="simple"
        profile={currentProfile}
        onProfileClick={handleSignOutAction}
      />

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 xl:px-8 pt-16 sm:pt-[4.75rem]">
        <Link
          href={`/anime/${anilistId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-200 transition-colors mb-3"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {animeTitle}
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-start gap-6 lg:gap-10">
          {/* MAIN COLUMN */}
          <div className="min-w-0 flex-1 space-y-6">
            {/* Player sits flat against the page — no card, no glow, no frame. */}
            <WatchPlayer
              playerContainerRef={playerContainerRef}
              videoRef={videoRef}
              triggerControlsActivity={triggerControlsActivity}
              isFullscreen={isFullscreen}
              loading={loading}
              setLoading={setLoading}
              error={error}
              setError={setError}
              setStatus={setStatus}
              episodeSnapshot={episodeSnapshot}
              onRetryEpisode={onRetryEpisode}
              handleVideoClick={handleVideoClick}
              skipSeconds={skipSeconds}
              seekFlash={seekFlash}
              setSeekFlash={setSeekFlash}
              playbackHasStartedRef={playbackHasStartedRef}
              playbackSourceReadyRef={playbackSourceReadyRef}
              mediaProgressHandlerRef={mediaProgressHandlerRef}
              mediaSuccessHandlerRef={mediaSuccessHandlerRef}
              mediaFailureHandlerRef={mediaFailureHandlerRef}
              stallRecoveryTimerRef={stallRecoveryTimerRef}
              activeSourceUrlRef={activeSourceUrlRef}
              provider={provider}
              subtitleTracks={subtitleTracks}
              isCropFill={isCropFill}
              playbackHasStarted={playbackHasStarted}
              setPlaybackHasStarted={setPlaybackHasStarted}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              duration={duration}
              setDuration={setDuration}
              setBufferedPercent={setBufferedPercent}
              setVideoQuality={setVideoQuality}
              skipIntervals={skipIntervals}
              fetchSkipTimestamps={fetchSkipTimestamps}
              commitPlaybackSessionToStorageLog={commitPlaybackSessionToStorageLog}
              navigateToNextEpisode={navigateToNextEpisode}
              handleTimeUpdate={handleTimeUpdate}
              animeTitle={animeTitle}
              episodeTitle={episodeTitle}
              epNum={epNum}
              isExternalMovie={isExternalMovie}
              captionsEnabled={captionsEnabled}
              applyCaptionMode={applyCaptionMode}
              isPiPActive={isPiPActive}
              togglePictureInPicture={togglePictureInPicture}
              showSettingsMenu={showSettingsMenu}
              setShowSettingsMenu={setShowSettingsMenu}
              videoQuality={videoQuality}
              playbackRate={playbackRate}
              applyPlaybackRate={applyPlaybackRate}
              settingsMenuRef={settingsMenuRef}
              currentCaption={currentCaption}
              currentActiveSkip={currentActiveSkip}
              showSkipButton={showSkipButton}
              executeManualSkipSegment={executeManualSkipSegment}
              showControls={showControls}
              togglePlay={togglePlay}
              currentTime={currentTime}
              bufferedPercent={bufferedPercent}
              handleScrub={handleScrub}
              formatTime={formatTime}
              volume={volume}
              isMuted={isMuted}
              setVolumeLevel={setVolumeLevel}
              toggleMute={toggleMute}
              showVolumeSlider={showVolumeSlider}
              revealVolumeSlider={revealVolumeSlider}
              scheduleHideVolumeSlider={scheduleHideVolumeSlider}
              volumeControlRef={volumeControlRef}
              toggleFullscreen={toggleFullscreen}
              toggleCropFill={toggleCropFill}
              autoplay={autoplay}
              toggleAutoplayState={toggleAutoplayState}
              autoskip={autoskip}
              toggleAutoskipState={toggleAutoskipState}
              autonext={autonext}
              toggleAutonextState={toggleAutonextState}
              hasNextEpisodeElement={hasNextEpisodeElement}
            />

            <EpisodeInfo
              isExternalMovie={isExternalMovie}
              isExternalMedia={isExternalMedia}
              animeTitle={animeTitle}
              epNum={epNum}
              episodeTitle={episodeTitle}
              mediaAirDate={mediaAirDate}
              watchProviders={watchProviders}
              navigateToPrevEpisode={navigateToPrevEpisode}
              navigateToNextEpisode={navigateToNextEpisode}
              hasPrevEpisode={hasPrevEpisode}
              hasNextEpisodeElement={hasNextEpisodeElement}
              handleDownload={handleDownload}
              downloadProgress={downloadProgress}
              downloadedFlag={downloadedFlag}
              activeCategory={activeCategory as "sub" | "dub"}
              handleCategoryChange={onCategoryChange}
              hasDubAvailable={hasDubAvailable}
              provider={provider}
              handleProviderChange={onProviderChange}
              availableProviders={availableProviders}
              autoplay={autoplay}
              toggleAutoplayState={toggleAutoplayState}
              autoskip={autoskip}
              toggleAutoskipState={toggleAutoskipState}
              autonext={autonext}
              toggleAutonextState={toggleAutonextState}
              episodeInfoExpanded={episodeInfoExpanded}
              setEpisodeInfoExpanded={setEpisodeInfoExpanded}
              episodeDesc={episodeDesc}
              isPlaying={isPlaying}
              togglePlay={togglePlay}
            />

            {/* UP NEXT — same visual pattern as a "Continue Watching" row: real
                thumbnails and real per-episode progress from progressMap, not
                filler. Desktop only; the full list already lives in the sidebar. */}
            {!isExternalMovie && currentDisplayedEpisodes.length > 1 && (
              <div className="hidden lg:block pt-2">
                <h2 className="text-base font-semibold text-white mb-4">Up Next</h2>
                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-neutral-800">
                  {currentDisplayedEpisodes
                    .filter((ep) => Number(ep.number) !== parseFloat(epNum))
                    .slice(0, 10)
                    .map((ep) => {
                      const epSlug = ep.id.includes("/") ? ep.id.split("/").pop() : ep.id;
                      const relativeSeason = activeTmdbSeasonInfo?.number ?? 1;
                      const relativeNumber = activeTmdbSeasonInfo
                        ? Number(ep.number) - activeTmdbSeasonInfo.absoluteOffset
                        : Number(ep.number);
                      const href = `/watch?provider=${provider}&id=${anilistId}&category=${activeCategory}&slug=${encodeURIComponent(
                        epSlug || ""
                      )}&epNum=${ep.number}&type=${mediaType}&season=${relativeSeason}`;
                      const thumb = ep.image || episodeSnapshot || "https://placehold.co/400x225?text=Episode";
                      const epPercent = progressMap[`${relativeSeason}-${relativeNumber}`]?.percent ?? 0;
                      return (
                        <Link key={ep.id} href={href} className="group shrink-0 w-64 rounded-md overflow-hidden bg-white/[0.03] hover:bg-white/[0.06] transition-colors">
                          <div className="flex items-center gap-3 p-2.5">
                            <div className="relative w-24 aspect-video rounded overflow-hidden bg-neutral-900 shrink-0">
                              <img
                                src={thumb}
                                alt={`Episode ${ep.number}`}
                                className="w-full h-full object-cover transition duration-300 group-hover:brightness-110"
                                loading="lazy"
                                decoding="async"
                              />
                              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition flex items-center justify-center bg-black/20">
                                <div className="w-6 h-6 rounded-full bg-white/95 flex items-center justify-center">
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="black">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-neutral-500">Season {relativeSeason} · E{relativeNumber}</p>
                              <p className="text-sm font-medium text-neutral-200 group-hover:text-white truncate transition-colors">
                                {ep.title || `Episode ${ep.number}`}
                              </p>
                            </div>
                          </div>
                          <div className="h-[3px] bg-white/10">
                            {epPercent > 0 && (
                              <div className="h-full bg-orange-500" style={{ width: `${Math.min(epPercent, 100)}%` }} />
                            )}
                          </div>
                        </Link>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* SIDEBAR */}
          <Sidebar
            isExternalMovie={isExternalMovie}
            sidebarTab={sidebarTab}
            setSidebarTab={setSidebarTab}
            tmdbSeasons={tmdbSeasons}
            selectedTmdbSeason={selectedTmdbSeason}
            setSelectedTmdbSeason={setSelectedTmdbSeason}
            seasonListRef={seasonListRef}
            episodeListRef={episodeListRef}
            currentDisplayedEpisodes={currentDisplayedEpisodes}
            epNum={epNum}
            provider={provider}
            anilistId={anilistId}
            activeCategory={activeCategory}
            mediaType={mediaType}
            episodeSnapshot={episodeSnapshot}
            duration={duration}
            progressMap={progressMap}
            activeTmdbSeasonInfo={activeTmdbSeasonInfo}
            CONTINUE_WATCHING_THRESHOLD={CONTINUE_WATCHING_THRESHOLD}
            formatTime={formatTime}
            tmdbSeasonLoading={tmdbSeasonLoading}
            totalEpisodesCount={totalEpisodesCount}
          />
        </div>

        {/* ── MORE LIKE THIS — Recommendations based on related anime ──── */}
        {moreLikeThisItems.length > 0 && (
          <div className="mt-12">
            <RecommendationsRow items={moreLikeThisItems} label="More Like This" />
          </div>
        )}
      </div>

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 flex items-center justify-around bg-neutral-950 border-t border-neutral-900 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] px-2">
        {[
          {
            key: "watch",
            label: "Watch",
            href: undefined,
            icon: (active: boolean) => (
              <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M8 5v14l11-7z" strokeLinejoin="round" />
              </svg>
            ),
          },
          {
            key: "explore",
            label: "Explore",
            href: "/",
            icon: () => (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M15 9l-2 6-4 2 2-6 4-2z" strokeLinejoin="round" />
              </svg>
            ),
          },
          {
            key: "bookmarks",
            label: "Bookmarks",
            href: "/bookmarks",
            icon: () => (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 4h12v16l-6-4-6 4V4z" strokeLinejoin="round" />
              </svg>
            ),
          },
          {
            key: "downloads",
            label: "Downloads",
            href: "/downloads",
            icon: () => (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ),
          },
          {
            key: "profile",
            label: "Profile",
            href: "/settings",
            icon: () => (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" strokeLinecap="round" />
              </svg>
            ),
          },
        ].map((item) => {
          const active = item.key === "watch";
          const content = (
            <>
              <span className={active ? "text-orange-500" : "text-neutral-500"}>{item.icon(active)}</span>
              <span className={`text-[10px] font-medium ${active ? "text-orange-500" : "text-neutral-500"}`}>
                {item.label}
              </span>
            </>
          );
          const className = "mobile-expand-hitbox flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors active:scale-95";
          return item.href ? (
            <Link key={item.key} href={item.href} className={className}>
              {content}
            </Link>
          ) : (
            <button
              key={item.key}
              type="button"
              className={className}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              {content}
            </button>
          );
        })}
      </nav>

      <style jsx global>{`
        * {
          -webkit-tap-highlight-color: transparent;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          user-select: none;
        }
        a,
        button {
          touch-action: manipulation;
        }
        input[type="range"] {
          touch-action: none;
        }
        .volume-vertical-input {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          cursor: pointer;
          margin: 0;
        }
        .volume-vertical-input::-webkit-slider-runnable-track {
          background: transparent;
        }
        .volume-vertical-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 22px;
          height: 22px;
          background: transparent;
        }
        .volume-vertical-input::-moz-range-track {
          background: transparent;
          border: none;
        }
        .volume-vertical-input::-moz-range-thumb {
          width: 22px;
          height: 22px;
          background: transparent;
          border: none;
        }
        img,
        video {
          -webkit-user-drag: none;
          user-drag: none;
        }
        html,
        body {
          -webkit-overflow-scrolling: touch;
        }
        .overflow-y-auto,
        .overflow-x-auto {
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
      `}</style>
    </main>
  );
}

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-black text-white font-mono text-sm">
          Loading Player...
        </div>
      }
    >
      <WatchContent />
    </Suspense>
  );
}
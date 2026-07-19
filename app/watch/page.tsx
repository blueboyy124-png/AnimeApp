"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase, SupabaseProfile } from "../utils/supabase";
import { saveOfflineDownload, makeDownloadId, isEpisodeDownloaded } from "../utils/offlineStore";
import { getApiBaseUrl, getTmdbEmbedApiUrl } from "../utils/api";

const BACKEND_API = getApiBaseUrl();
const TMDB_EMBED_API = getTmdbEmbedApiUrl();

const STABILITY_PRIORITY = ["bee", "kiwi", "pewe", "bonk"];
const SKIP_COUNTDOWN_DURATION = 7000; // 7 seconds timeout for Netflix-style skip button

interface EpisodeNode {
  id: string;
  number: number;
  title?: string;
  description?: string;
  image?: string;
  slug?: string;
}

type ViewStyle = "compact" | "detailed" | "cinematic";

type SkipIntervalItem = {
  skipId: string;
  skipType: "op" | "ed";
  interval: { startTime: number; endTime: number };
  source?: string;
  confidence?: number;
  episodeLength?: number;
};

// Animated switch — replaces the old checkbox inputs. 180ms transition on
// both the track color and the thumb position keeps it feeling snappy
// without being distracting mid-playback.
function ToggleSwitch({
  checked,
  onChange,
  label,
  compact = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <label
      className={`mobile-expand-hitbox flex items-center gap-2 cursor-pointer select-none group ${
        compact ? "px-3 py-1.5 rounded-lg hover:bg-neutral-800/40 transition" : "py-1"
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors duration-180 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 ${
          checked ? "bg-orange-500" : "bg-neutral-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-[14px] h-[14px] bg-white rounded-full shadow transition-transform duration-180 ${
            checked ? "translate-x-[14px]" : "translate-x-0"
          }`}
        />
      </button>
      <span className="text-xs font-mono text-neutral-300 group-hover:text-white transition-colors duration-180 hidden sm:inline">
        {label}
      </span>
    </label>
  );
}

// Caches the RESOLVED stream source (URL/referer/provider/subtitles) per
// episode for a short window — this is what makes "go back to home, click
// back into the same show" feel instant: it skips the whole
// provider-fallback resolution loop and jumps straight to loading the
// stream. Capped at a few minutes because these URLs are often
// short-lived/signed by the provider, so caching them for too long would
// serve a dead link instead of actually being faster.
const SOURCE_CACHE_KEY = "streamanime_source_cache";
const SOURCE_CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes

function loadSourceCache(): Record<string, any> {
  try {
    return JSON.parse(sessionStorage.getItem(SOURCE_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSourceCache(cache: Record<string, any>) {
  try {
    // Cap size — this is a short-lived convenience cache, not meant to
    // grow unbounded across a long browsing session.
    const keys = Object.keys(cache);
    if (keys.length > 30) {
      keys
        .sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0))
        .slice(0, keys.length - 30)
        .forEach((k) => delete cache[k]);
    }
    sessionStorage.setItem(SOURCE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // sessionStorage full/unavailable — non-fatal, just means this visit
    // won't get the instant-resume speedup.
  }
}

function extractEpisodeLists(epData: any, provider: string) {
  const block =
    epData?.results?.providers?.[provider] ??
    epData?.providers?.[provider]          ??
    epData?.results?.[provider]            ??
    epData?.[provider];

  if (!block) return { subList: [] as EpisodeNode[], dubList: [] as EpisodeNode[] };

  const root = block?.episodes ?? block ?? {};
  return {
    subList: (root.sub ?? root.SUB ?? []) as EpisodeNode[],
    dubList: (root.dub ?? root.DUB ?? []) as EpisodeNode[],
  };
}

function normalizeSkipIntervals(rawItems: any[], episodeLength: number, source: string): SkipIntervalItem[] {
  const deduped = new Map<string, SkipIntervalItem>();

  for (const raw of rawItems || []) {
    const normalizedType = String(
      raw?.skipType ?? raw?.type ?? raw?.skip_type ?? raw?.category ?? raw?.kind ?? ""
    ).toLowerCase();

    const skipType: "op" | "ed" | null = normalizedType.includes("ed")
      ? "ed"
      : normalizedType.includes("op")
        ? "op"
        : null;

    const startTime = Number(
      raw?.interval?.startTime ?? raw?.interval?.start ?? raw?.startTime ?? raw?.start ?? raw?.start_time ?? raw?.from ?? raw?.fromTime
    );
    const endTime = Number(
      raw?.interval?.endTime ?? raw?.interval?.end ?? raw?.endTime ?? raw?.end ?? raw?.end_time ?? raw?.to ?? raw?.toTime
    );

    if (!skipType || !Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
    if (endTime <= startTime || startTime < 0 || endTime > Math.max(episodeLength + 30, 1)) continue;

    const item = {
      skipId: `${source}-${skipType}-${Math.round(startTime)}-${Math.round(endTime)}`,
      skipType,
      interval: { startTime, endTime },
      source,
      confidence: Number(raw?.confidence ?? raw?.confidenceScore ?? 0.8) || 0.8,
      episodeLength,
    };

    deduped.set(item.skipId, item);
  }

  return Array.from(deduped.values()).sort((a, b) => a.interval.startTime - b.interval.startTime);
}

function buildConventionalFallbackIntervals(episodeLength: number, episodeNumber: number): SkipIntervalItem[] {
  const isFirstEpisode = Math.floor(episodeNumber) === 1;
  const fallbackSet: SkipIntervalItem[] = [];

  if (!isFirstEpisode && episodeLength > 300) {
    fallbackSet.push({
      skipId: "fallback-op",
      skipType: "op",
      interval: { startTime: 90, endTime: 180 },
      source: "fallback",
      confidence: 0.65,
      episodeLength,
    });
  }

  if (episodeLength > 240) {
    fallbackSet.push({
      skipId: "fallback-ed",
      skipType: "ed",
      interval: { startTime: episodeLength - 120, endTime: episodeLength - 30 },
      source: "fallback",
      confidence: 0.65,
      episodeLength,
    });
  }

  return fallbackSet;
}

function WatchContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const pathname     = usePathname();

  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef           = useRef<HTMLVideoElement | null>(null);
  const hlsRef             = useRef<any>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const skipTimerRef       = useRef<NodeJS.Timeout | null>(null);

  const savedTimeRef     = useRef<number>(0);
  const episodesCacheRef = useRef<{ id: string; data: any } | null>(null);
  const lastSkipTypeRef  = useRef<"op" | "ed" | null>(null);
  const isNavigatingRef  = useRef(false);
  const forceStartFromZeroRef = useRef(false);

  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [status,          setStatus]          = useState("Initializing Core...");
  const [subSlug,         setSubSlug]         = useState<string | null>(null);
  const [dubSlug,         setDubSlug]         = useState<string | null>(null);
  const [hasDubAvailable, setHasDubAvailable] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);

  const [episodes,        setEpisodes]        = useState<EpisodeNode[]>([]);
  const [viewStyle,       setViewStyle]       = useState<ViewStyle>("compact");
  const [activeRangeIndex, setActiveRangeIndex] = useState<number>(0);

  const [isPlaying,       setIsPlaying]       = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [seekFlash,       setSeekFlash]       = useState<{ side: "left" | "right"; key: number } | null>(null);
  const [currentTime,     setCurrentTime]     = useState(0);
  const [duration,        setDuration]        = useState(0);
  const [volume,          setVolume]          = useState(1);
  const [isMuted,         setIsMuted]         = useState(false);
  const [isFullscreen,    setIsFullscreen]    = useState(false);
  const [showControls,    setShowControls]    = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [subtitleTracks, setSubtitleTracks] = useState<Array<{ url: string; label: string; language: string; isDefault?: boolean }>>([]);
  const [currentCaption,  setCurrentCaption]  = useState<string>("");

  // Extracted movie/TV stream URL (native playback, no iframe)
  const [externalStreamUrl, setExternalStreamUrl] = useState<string | null>(null);

  const [animeTitle,      setAnimeTitle]      = useState<string>("Anime Series");
  const [episodeTitle,    setEpisodeTitle]    = useState<string>("Currently Loading...");
  const [episodeDesc,     setEpisodeDesc]     = useState<string>("");
  const [episodeSnapshot, setEpisodeSnapshot] = useState<string>("");

  const [skipIntervals,   setSkipIntervals]   = useState<any[]>([]);
  const [currentActiveSkip, setCurrentActiveSkip] = useState<any | null>(null);
  const [showSkipButton,  setShowSkipButton]  = useState(false);

  // Active User Profile Context State
  const [currentProfile,  setCurrentProfile]  = useState<SupabaseProfile | null>(null);

  // Automation Preferences States
  const [autoplay,        setAutoplay]        = useState<boolean>(true);
  const [autoskip,        setAutoskip]        = useState<boolean>(false);
  const [autonext,        setAutonext]        = useState<boolean>(true);

  const [isMounted, setIsMounted] = useState(false);

  // Fullscreen crop-to-fill state (removes letterbox black bars by cropping sides)
  const [isCropFill, setIsCropFill] = useState(false);

  // URL Parameters Configuration
  const urlProvider = searchParams.get("provider");
  const mediaType   = searchParams.get("type") ?? searchParams.get("mediaType") ?? "anime";
  const anilistId   = searchParams.get("id") ?? searchParams.get("anilistId") ?? searchParams.get("tmdbId") ?? "0";
  const category    = searchParams.get("category");
  const rawSlug     = searchParams.get("slug")       ?? "";
  const epNum       = searchParams.get("epNum")      ?? "1";
  const seasonNum   = searchParams.get("season")     ?? "1";

  const currentSlug = rawSlug
    ? (rawSlug.includes("watch/") ? rawSlug.split("/").pop() ?? rawSlug : rawSlug)
    : "";

  // External (movie/TV) content identification
  const isExternalMedia = 
    mediaType === "movie" || 
    mediaType === "series" || 
    mediaType === "tv" || 
    urlProvider === "tmdb" || 
    urlProvider === "omdb" || 
    /^tmdb-(?:movie|tv)-/i.test(anilistId) ||
    /^tt\d+/i.test(anilistId);

  // Movie vs. TV episode distinction
  const isExternalMovie = 
    mediaType === "movie" ||
    /^tmdb-movie-/i.test(anilistId) ||
    (isExternalMedia && !/^tt/i.test(currentSlug) && mediaType !== "series" && mediaType !== "tv" && !/^tmdb-tv-/i.test(anilistId));

  // Load Active Session Profile
  const loadActiveProfileData = useCallback(async () => {
    try {
      const activeId = localStorage.getItem("streamanime_active_profile_id");
      if (!activeId) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", activeId)
        .maybeSingle();

      if (!error && data) {
        setCurrentProfile(data);
      }
    } catch (err) {
      console.error("Error pulling top header profile badge metadata:", err);
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
    loadActiveProfileData();

    if (typeof window === "undefined") return;

    const storedAutoplay = localStorage.getItem("streamanime_autoplay");
    const storedAutoskip = localStorage.getItem("streamanime_autoskip");
    const storedAutonext = localStorage.getItem("streamanime_autonext");
    
    if (storedAutoplay !== null) setAutoplay(storedAutoplay === "true");
    if (storedAutoskip !== null) setAutoskip(storedAutoskip === "true");
    if (storedAutonext !== null) setAutonext(storedAutonext === "true");

    const savedLang = localStorage.getItem("streamanime_pref_lang") ?? "sub";
    const savedProv = localStorage.getItem("streamanime_pref_provider");

    let parametersChanged = false;
    const nextParams = new URLSearchParams(searchParams.toString());

    if (!category) {
      nextParams.set("category", savedLang);
      parametersChanged = true;
    } else {
      localStorage.setItem("streamanime_pref_lang", category);
    }

    if (!urlProvider && savedProv) {
      nextParams.set("provider", savedProv);
      parametersChanged = true;
    } else if (urlProvider) {
      localStorage.setItem("streamanime_pref_provider", urlProvider);
    }

    if (parametersChanged) {
      router.replace(`${pathname}?${nextParams.toString()}`);
    }
  }, [category, urlProvider, searchParams, pathname, router, loadActiveProfileData]);

  // Update browser tab title and media session for lock screen display
  useEffect(() => {
    const title = `Episode ${epNum} — ${episodeTitle || "Anime"}`;
    document.title = title;

    if ("mediaSession" in navigator && videoRef.current) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `Episode ${epNum}`,
          artist: episodeTitle || "Anime",
          album: animeTitle,
          artwork: episodeSnapshot ? [{ src: episodeSnapshot }] : [],
        });
      } catch {
        // MediaSession not supported
      }
    }
  }, [epNum, episodeTitle, animeTitle, episodeSnapshot]);

  const activeCategory = category ?? "sub";
  const provider = urlProvider ?? "kiwi";

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      try { hlsRef.current.detachMedia(); hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.src = ""; videoRef.current.load(); } catch {}
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        try { hlsRef.current.detachMedia(); hlsRef.current.destroy(); } catch {}
      }
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    };
  }, []);

  const triggerControlsActivity = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3500);
    }
  }, [isPlaying]);

  useEffect(() => {
    triggerControlsActivity();
    return () => { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); };
  }, [triggerControlsActivity]);

  const navigateToNextEpisode = useCallback(() => {
    if (isNavigatingRef.current) return;
    const currentEpNum = parseFloat(epNum);
    const sorted = [...episodes].sort((a, b) => a.number - b.number);
    const nextEp = sorted.find((e) => Number(e.number) > currentEpNum);
    if (!nextEp) return;

    const slug = nextEp.id.includes("/")
      ? nextEp.id.split("/").pop() ?? nextEp.id
      : nextEp.id;

    const p = new URLSearchParams(searchParams.toString());
    p.set("epNum", String(nextEp.number));
    p.set("slug", slug);
    savedTimeRef.current = 0;
    forceStartFromZeroRef.current = true;
    isNavigatingRef.current = true;
    router.push(`${pathname}?${p.toString()}`);
  }, [episodes, epNum, searchParams, pathname, router]);

  const navigateToPrevEpisode = useCallback(() => {
    if (isNavigatingRef.current) return;
    const currentEpNum = parseFloat(epNum);
    const sorted = [...episodes].sort((a, b) => b.number - a.number); 
    const prevEp = sorted.find((e) => Number(e.number) < currentEpNum);
    if (!prevEp) return;

    const slug = prevEp.id.includes("/")
      ? prevEp.id.split("/").pop() ?? prevEp.id
      : prevEp.id;

    const p = new URLSearchParams(searchParams.toString());
    p.set("epNum", String(prevEp.number));
    p.set("slug", slug);
    savedTimeRef.current = 0;
    forceStartFromZeroRef.current = true;
    isNavigatingRef.current = true;
    router.push(`${pathname}?${p.toString()}`);
  }, [episodes, epNum, searchParams, pathname, router]);

  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedFlag, setDownloadedFlag] = useState(false);

  useEffect(() => {
    const activeId = localStorage.getItem("streamanime_active_profile_id");
    if (!activeId || !anilistId) return;
    isEpisodeDownloaded(activeId, anilistId, epNum).then(setDownloadedFlag);
  }, [anilistId, epNum]);

  const handleDownload = async () => {
    if (!provider || !anilistId || !currentSlug || downloadProgress !== null) return;

    const activeId = localStorage.getItem("streamanime_active_profile_id");
    if (!activeId) {
      alert("You need an active profile to save downloads.");
      return;
    }

    setDownloadProgress(0);
    try {
      const url = `${BACKEND_API}/download?provider=${provider}&anilistId=${anilistId}&category=${activeCategory}&slug=${encodeURIComponent(currentSlug)}`;
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);

      const contentLength = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      setDownloadProgress(contentLength ? 0 : -1);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          if (contentLength) setDownloadProgress(Math.min(99, Math.round((received / contentLength) * 100)));
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: "video/mp4" });

      if (blob.size === 0) {
        throw new Error("Received an empty file from the server.");
      }

      await saveOfflineDownload({
        id: makeDownloadId(activeId, anilistId, epNum),
        profileId: activeId,
        anilistId: String(anilistId),
        animeTitle,
        episodeNumber: String(epNum),
        episodeImage: episodeSnapshot || "",
        category: activeCategory,
        blob,
        sizeBytes: blob.size,
        downloadedAt: Date.now(),
      });

      setDownloadProgress(100);
      setDownloadedFlag(true);
      window.setTimeout(() => setDownloadProgress(null), 1200);
    } catch (err) {
      console.error("Offline download failed:", err);
      alert("Download failed. Try again in a moment.");
      setDownloadProgress(null);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    isPlaying ? videoRef.current.pause() : videoRef.current.play().catch(() => {});
    triggerControlsActivity();
  };

  const handleVideoClick = () => {
    if (showControls) {
      setShowControls(false);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
  };

  const applyCaptionMode = useCallback((enabled: boolean) => {
    setCaptionsEnabled(enabled);
    if (!videoRef.current) return;

    const tracks = videoRef.current.textTracks;
    for (let i = 0; i < tracks.length; i += 1) {
      tracks[i].mode = enabled ? "showing" : "hidden";
    }
  }, []);

  const skipSeconds = (amount: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + amount));
    triggerControlsActivity();
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const t = parseFloat(e.target.value);
    videoRef.current.currentTime = t;
    setCurrentTime(t);
    triggerControlsActivity();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const v = parseFloat(e.target.value);
    videoRef.current.volume = v;
    setVolume(v);
    setIsMuted(v === 0);
    videoRef.current.muted = v === 0;
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const next = !isMuted;
    videoRef.current.muted = next;
    setIsMuted(next);
  };

  // Safe custom sandbox wrapper that bypasses native overlay on mobile
  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
    triggerControlsActivity();
  };

  useEffect(() => {
    const syncFullscreenState = () => {
      const isCurrentlyFull = !!(document.fullscreenElement || (document.fullscreenElement as any));
      if (document.fullscreenEnabled || (document as any).webkitFullscreenEnabled) {
        setIsFullscreen(isCurrentlyFull);
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

  // Keyboard shortcuts — ignored while typing in an input/textarea so they
  // don't hijack search boxes or text fields elsewhere on the page.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isTyping) return;

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "arrowright":
          e.preventDefault();
          skipSeconds(10);
          break;
        case "arrowleft":
          e.preventDefault();
          skipSeconds(-10);
          break;
        case "arrowup":
          e.preventDefault();
          if (videoRef.current) {
            const next = Math.min(1, (isMuted ? 0 : volume) + 0.1);
            videoRef.current.volume = next;
            videoRef.current.muted = false;
            setVolume(next);
            setIsMuted(false);
          }
          break;
        case "arrowdown":
          e.preventDefault();
          if (videoRef.current) {
            const next = Math.max(0, (isMuted ? 0 : volume) - 0.1);
            videoRef.current.volume = next;
            setVolume(next);
            setIsMuted(next === 0);
            videoRef.current.muted = next === 0;
          }
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted, volume]);

  // Lock body scroll when in custom CSS fullscreen; restore + jump to top on exit
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  const handleCategoryChange = (target: "sub" | "dub") => {
    // The TMDB provider API currently exposes one primary audio track. Do
    // not send movie/TV titles through the anime sub/dub resolver.
    if (isExternalMedia) return;
    if (target === activeCategory) return;
    localStorage.setItem("streamanime_pref_lang", target);
    const targetedSlug = target === "dub" ? dubSlug : subSlug;
    if (!targetedSlug) return;
    if (videoRef.current && isFinite(videoRef.current.currentTime)) {
      savedTimeRef.current = videoRef.current.currentTime;
    }
    setIsPlaying(false);
    destroyHls();
    setLoading(true);
    const p = new URLSearchParams(searchParams.toString());
    p.set("category", target);
    p.set("slug", targetedSlug);
    router.push(`${pathname}?${p.toString()}`);
  };

  const handleProviderChange = (newProvider: string) => {
    if (newProvider === provider) return;
    localStorage.setItem("streamanime_pref_provider", newProvider);
    if (videoRef.current && isFinite(videoRef.current.currentTime)) {
      savedTimeRef.current = videoRef.current.currentTime;
    }
    setIsPlaying(false);
    destroyHls();
    setLoading(true);
    const p = new URLSearchParams(searchParams.toString());
    p.set("provider", newProvider);
    p.set("slug", "");
    router.push(`${pathname}?${p.toString()}`);
  };

  const toggleAutoplayState = () => {
    const next = !autoplay;
    setAutoplay(next);
    localStorage.setItem("streamanime_autoplay", String(next));
  };

  const toggleAutoskipState = () => {
    const next = !autoskip;
    setAutoskip(next);
    localStorage.setItem("streamanime_autoskip", String(next));
  };

  const toggleAutonextState = () => {
    const next = !autonext;
    setAutonext(next);
    localStorage.setItem("streamanime_autonext", String(next));
  };

  const toggleCropFill = () => {
    setIsCropFill((prev) => !prev);
  };

  const handleSignOutAction = () => {
    const activeId = localStorage.getItem("streamanime_active_profile_id");
    if (activeId) localStorage.removeItem(`streamanime_watch_history_${activeId}`);
    localStorage.removeItem("streamanime_watch_history"); // legacy/global key cleanup
    localStorage.removeItem("streamanime_active_profile_id");
    window.location.reload();
  };

  const commitPlaybackSessionToStorageLog = useCallback(async (current: number, total: number) => {
    if (!anilistId || anilistId === "0" || !total || total <= 0) return;
    try {
      const activeId = localStorage.getItem("streamanime_active_profile_id");
      const storageKey = activeId
        ? `streamanime_watch_history_${activeId}`
        : "streamanime_watch_history";

      const raw = localStorage.getItem(storageKey);
      let list: any[] = raw ? JSON.parse(raw) : [];

      list = list.filter((item: any) => String(item.anilistId) !== String(anilistId));

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
        updatedAt: Date.now(),
      };

      list.unshift(trackingPayload);
      const optimizedHistorySlice = list.slice(0, 20);
      
      localStorage.setItem(storageKey, JSON.stringify(optimizedHistorySlice));

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
  }, [anilistId, animeTitle, epNum, episodeSnapshot, provider, activeCategory, currentSlug]);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);

    if (videoRef.current.textTracks && videoRef.current.textTracks.length > 0) {
      let activeCueText = "";
      const currentTracks = videoRef.current.textTracks;
      for (let t = 0; t < currentTracks.length; t++) {
        const track = currentTracks[t];
        if (track.mode === "showing" && track.activeCues) {
          for (let c = 0; c < track.activeCues.length; c++) {
            const cue = track.activeCues ? track.activeCues[c] : (track.activeCues[c] as any);
            if (cue && cue.text) {
              activeCueText = cue.text;
            }
          }
        }
      }
      setCurrentCaption(activeCueText);
    }

    if (Math.floor(time) % 4 === 0 && videoRef.current.duration) {
      commitPlaybackSessionToStorageLog(time, videoRef.current.duration);
    }

    const activeBlock = skipIntervals.find(
      (s) => time >= s.interval.startTime && time <= s.interval.endTime
    );

    if (activeBlock) {
      if (autoskip) {
        lastSkipTypeRef.current = null;
        videoRef.current.currentTime = activeBlock.interval.endTime + 0.1;
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
  };

  const executeManualSkipSegment = () => {
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
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const fetchTimestampsFromAniSkip = useCallback(async (targetDuration: number) => {
    const id = parseInt(anilistId, 10);
    const epFloat = parseFloat(epNum);
    const exactSeconds = Math.floor(targetDuration);

    if (!id || isNaN(id) || isNaN(exactSeconds) || exactSeconds <= 60) return;

    if (typeof window !== "undefined") {
      const cacheKey = `skip-cache:${id}:${Math.floor(epFloat)}:${exactSeconds}`;
      const cachedPayload = window.localStorage.getItem("streamanime_skip_cache_v2");
      if (cachedPayload) {
        try {
          const parsedCache = JSON.parse(cachedPayload);
          const cachedIntervals = parsedCache?.[cacheKey];
          if (Array.isArray(cachedIntervals) && cachedIntervals.length > 0) {
            setSkipIntervals(cachedIntervals);
            return;
          }
        } catch {}
      }
    }

    const applyFallbackIntervals = (intervals: SkipIntervalItem[] | null = null) => {
      const resolved = intervals && intervals.length > 0
        ? intervals
        : buildConventionalFallbackIntervals(exactSeconds, epFloat);
      setSkipIntervals(resolved);

      if (typeof window !== "undefined") {
        const cacheKey = `skip-cache:${id}:${Math.floor(epFloat)}:${exactSeconds}`;
        const cachedPayload = window.localStorage.getItem("streamanime_skip_cache_v2");
        const nextCache = cachedPayload ? JSON.parse(cachedPayload) : {};
        nextCache[cacheKey] = resolved;
        window.localStorage.setItem("streamanime_skip_cache_v2", JSON.stringify(nextCache));
      }
    };

    try {
      const infoRes = await fetch(`${BACKEND_API}/info/${id}`);
      let malId: number | null = null;
      if (infoRes.ok) {
        const infoData = await infoRes.json();
        malId = parseInt(
          String(
            infoData?.results?.malId ??
            infoData?.results?.idMal ??
            infoData?.malId ??
            infoData?.idMal ??
            infoData?.results?.mal_id ??
            infoData?.mal_id ??
            ""
          ),
          10
        );
      }

      let targetedMalId = Number.isFinite(malId) ? malId! : 0;
      let targetedEpisode = Math.floor(epFloat);

      if (targetedMalId === 21) {
        if (targetedEpisode <= 206) {
          targetedMalId = 21;
        } else if (targetedEpisode <= 516) {
          targetedMalId = 459;
          targetedEpisode = targetedEpisode - 206;
        } else if (targetedEpisode <= 891) {
          targetedMalId = 918;
          targetedEpisode = targetedEpisode - 516;
        } else if (targetedEpisode <= 1084) {
          targetedMalId = 38234;
          targetedEpisode = targetedEpisode - 891;
        } else {
          targetedMalId = 56715;
          targetedEpisode = targetedEpisode - 1084;
        }
      }

      const candidateSources = [
        {
          name: "AniSkip",
          url: `https://api.aniskip.com/v2/skip-times/${targetedMalId}/${targetedEpisode}?types=op&types=ed&episodeLength=${exactSeconds}`,
          parser: (data: any) => {
            const rawResults = data?.results ?? data?.skipTimes ?? data?.skip_times ?? [];
            return normalizeSkipIntervals(Array.isArray(rawResults) ? rawResults : [], exactSeconds, "aniskip");
          },
        },
        {
          name: "IntroDB",
          url: `https://introdb.com/api/v2?anilistId=${id}&episode=${targetedEpisode}&episodeLength=${exactSeconds}`,
          parser: (data: any) => {
            const rawResults = data?.results ?? data?.episodes ?? data?.skipTimes ?? data?.skip_times ?? [];
            return normalizeSkipIntervals(Array.isArray(rawResults) ? rawResults : [], exactSeconds, "introdb");
          },
        },
      ];

      let collected: SkipIntervalItem[] = [];
      for (const source of candidateSources) {
        try {
          const res = await fetch(source.url, { cache: "no-store" });
          if (!res.ok) continue;
          const data = await res.json();
          const parsed = source.parser(data);
          if (parsed.length > 0) {
            collected = [...collected, ...parsed];
          }
        } catch {
          // Ignore provider outage and continue to the next source.
        }
      }

      const deduped = Array.from(
        new Map(
          collected.map((item) => [`${item.skipType}:${item.interval.startTime}:${item.interval.endTime}`, item])
        ).values()
      ).sort((a, b) => a.interval.startTime - b.interval.startTime);

      if (deduped.length > 0) {
        applyFallbackIntervals(deduped);
      } else {
        applyFallbackIntervals();
      }
    } catch {
      applyFallbackIntervals();
    }
  }, [anilistId, epNum]);

  useEffect(() => {
    if (isExternalMedia) return;

    const id = parseInt(anilistId, 10);
    const epFloat = parseFloat(epNum);
    if (!id || isNaN(id)) return;

    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError(null);
        setSkipIntervals([]);
        setCurrentActiveSkip(null);
        setShowSkipButton(false);
        lastSkipTypeRef.current = null;
        isNavigatingRef.current = false;

        let epData: any;
        if (episodesCacheRef.current?.id === anilistId) {
          epData = episodesCacheRef.current.data;
        } else {
          const res = await fetch(`${BACKEND_API}/episodes/${id}`);
          if (res.ok) {
            epData = await res.json();
            episodesCacheRef.current = { id: anilistId, data: epData };
          }
        }

        if (epData) {
          const providerGroup = epData?.results?.providers || epData?.providers || {};
          const discovered = Object.keys(providerGroup).filter(
            (k) => k !== "subtitles" && k !== "banners"
          );
          if (!cancelled) setAvailableProviders(discovered);

          const { subList, dubList } = extractEpisodeLists(epData, provider);
          const activeList = activeCategory === "dub" ? dubList : subList;
          const sorted = [...activeList].sort((a, b) => a.number - b.number);
          if (!cancelled) setEpisodes(sorted);

          const subNode = subList.find((e) => Number(e.number) === epFloat);
          const dubNode = dubList.find((e) => Number(e.number) === epFloat);

          if (!cancelled) {
            setSubSlug(subNode ? subNode.slug ?? subNode.id : null);
            setDubSlug(dubNode ? dubNode.slug ?? dubNode.id : null);
            setHasDubAvailable(dubList.length > 0);

            const matchedNode = activeList.find((e) => Number(e.number) === epFloat);
            if (matchedNode) {
              if (matchedNode.image) setEpisodeSnapshot(matchedNode.image);
              setEpisodeTitle(matchedNode.title || `Episode ${matchedNode.number}`);
              setEpisodeDesc(matchedNode.description || "");
            }
          }

          try {
            const infoRes = await fetch(`${BACKEND_API}/info/${id}`);
            if (infoRes.ok) {
              const infoData = await infoRes.json();
              const showTitle =
                infoData?.results?.title?.english  ??
                infoData?.results?.title?.romaji   ??
                infoData?.title?.english           ??
                infoData?.title?.romaji;

              if (showTitle && !cancelled) setAnimeTitle(showTitle);
            }
          } catch {}
        }

        let targetStreamUrl = "";
        let targetReferer   = "https://kwik.cx/";
        let selectedProvider = provider;
        let targetSubtitles: any[] = [];

        const sourceCacheKey = `${anilistId}:${activeCategory}:${epNum}`;
        const sourceCache = loadSourceCache();
        const cachedSource = sourceCache[sourceCacheKey];
        const sourceCacheHit =
          cachedSource && Date.now() - (cachedSource.cachedAt || 0) < SOURCE_CACHE_TTL_MS;

        if (sourceCacheHit) {
          targetStreamUrl = cachedSource.streamUrl;
          targetReferer = cachedSource.referer;
          selectedProvider = cachedSource.selectedProvider;
          targetSubtitles = cachedSource.subtitles || [];
        }

        const fallbackQueue = Array.from(new Set([
          provider,
          ...STABILITY_PRIORITY,
          ...(epData ? Object.keys(epData?.results?.providers || epData?.providers || {}) : []),
        ]));

        for (const provKey of (sourceCacheHit ? [] : fallbackQueue)) {
          if (cancelled) return;

          let slug = "";
          if (epData) {
            const { subList, dubList } = extractEpisodeLists(epData, provKey);
            const list = activeCategory === "dub" ? dubList : subList;
            const match = list.find((e) => Number(e.number) === epFloat);
            if (match) {
              slug = match.id.includes("/")
                ? match.id.split("/").pop() ?? match.id
                : match.id;
            }
          }

          if (!slug) continue;

          try {
            if (!cancelled) setStatus(`Routing via [${provKey.toUpperCase()}]...`);
            const watchRes = await fetch(
              `${BACKEND_API}/watch/${provKey}/${id}/${activeCategory}/${encodeURIComponent(slug)}`
            );
            if (!watchRes.ok) throw new Error(`${watchRes.status}`);

            const data = await watchRes.json();
            let url = data?.results?.bestStream?.url ?? data?.bestStream?.url;
            let ref = data?.results?.bestStream?.referer ?? data?.bestStream?.referer;
            const subs = data?.results?.subtitles ?? data?.subtitles ?? [];

            if (!url) {
              const streams = (data?.results?.streams ?? data?.streams ?? []) as any[];
              const chosen = streams.find((s) => s.type === "hls" && s.url);
              if (chosen) { url = chosen.url; if (chosen.referer) ref = chosen.referer; }
            }

            if (url) {
              targetStreamUrl  = url;
              if (ref) targetReferer = ref;
              selectedProvider = provKey;
              targetSubtitles = Array.isArray(subs) ? subs : [];
              break;
            }
          } catch {
            console.warn(`[watch] Provider [${provKey}] failed, trying next...`);
          }
        }

        if (!targetStreamUrl) {
          throw new Error("All providers failed. Try switching the audio track or refreshing.");
        }
        if (cancelled) return;

        if (!sourceCacheHit) {
          sourceCache[sourceCacheKey] = {
            streamUrl: targetStreamUrl,
            referer: targetReferer,
            selectedProvider,
            subtitles: targetSubtitles,
            cachedAt: Date.now(),
          };
          saveSourceCache(sourceCache);
        }

        if (selectedProvider !== provider) {
          const p = new URLSearchParams(searchParams.toString());
          p.set("provider", selectedProvider);
          router.replace(`${pathname}?${p.toString()}`);
        }

        let initialTime = 0;
        if (forceStartFromZeroRef.current) {
          forceStartFromZeroRef.current = false;
          savedTimeRef.current = 0;
        } else if (savedTimeRef.current > 0) {
          initialTime = savedTimeRef.current;
          savedTimeRef.current = 0;
        } else {
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
                  String(item.episodeNumber) === String(epNum)
              );
              if (log && log.currentTime > 5) {
                if (!log.duration || log.duration - log.currentTime > 15) {
                  initialTime = log.currentTime;
                }
              }
            }
          } catch {}
        }

        const proxyUrl =
          `/api/stream-proxy` +
          `?url=${encodeURIComponent(targetStreamUrl)}` +
          `&referer=${encodeURIComponent(targetReferer)}`;

        setSubtitleTracks(
          targetSubtitles
            .filter((s: any) => s?.url)
            .map((s: any) => ({
              url: `/api/stream-proxy?url=${encodeURIComponent(s.url)}&referer=${encodeURIComponent(targetReferer)}`,
              label: s.label || s.language || "Subtitles",
              language: s.language || s.lang || "en",
              isDefault: !!s.isDefault || !!s.default,
            }))
        );

        destroyHls();
        if (cancelled) return;

        const { default: Hls } = await import("hls.js");
        if (cancelled || !videoRef.current) return;

        if (Hls.isSupported()) {
          let codecRecoveries = 0;
          let mediaRecoveries = 0;

          const hls = new Hls({
            enableWorker:             false,
            preferManagedMediaSource: false,
            startLevel:               -1,
            maxBufferLength:          30,
            maxMaxBufferLength:       60,
            backBufferLength:         30,
            maxBufferHole:            0.8,
            nudgeMaxRetry:            5,
            fragLoadingTimeOut:       20000,
            fragLoadingMaxRetry:      4,
          });

          hlsRef.current = hls;
          hls.loadSource(proxyUrl);
          hls.attachMedia(videoRef.current);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            setLoading(false);
            if (videoRef.current) {
              videoRef.current.currentTime = initialTime;
            }
            if (autoplay && videoRef.current) {
              videoRef.current.play().catch(() => {});
            }

            if (videoRef.current) {
              const textTracks = videoRef.current.textTracks;
              for (let i = 0; i < textTracks.length; i++) {
                textTracks[i].mode = captionsEnabled ? "showing" : "hidden";
              }
            }
          });

          hls.on(Hls.Events.ERROR, (_: any, data: any) => {
            if (!data.fatal) return;
            if (data.details === "bufferAddCodecError") {
              if (codecRecoveries === 0) {
                codecRecoveries++;
                hls.currentLevel = 0;
                hls.recoverMediaError();
              } else {
                if (!cancelled) {
                  setError(`Unsupported codec. Try refreshing.`);
                  setLoading(false);
                }
                destroyHls();
              }
              return;
            }
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
              return;
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              if (mediaRecoveries === 0) {
                mediaRecoveries++;
                hls.recoverMediaError();
              } else if (mediaRecoveries === 1) {
                mediaRecoveries++;
                hls.swapAudioCodec();
                hls.recoverMediaError();
              } else {
                if (!cancelled) {
                  setError(`Playback failed. Try reloading.`);
                  setLoading(false);
                }
                destroyHls();
              }
              return;
            }
            if (!cancelled) {
              setError(`Fatal error: ${data.details}`);
              setLoading(false);
            }
            destroyHls();
          });

        } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
          videoRef.current.src = proxyUrl;
          videoRef.current.addEventListener("loadedmetadata", () => {
            if (cancelled) return;
            setLoading(false);
            if (videoRef.current) videoRef.current.currentTime = initialTime;
            if (autoplay) videoRef.current?.play().catch(() => {});
          }, { once: true });
        } else {
          throw new Error("Browser does not support HLS playback.");
        }

      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? "Pipeline linking failed.");
          setLoading(false);
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [provider, anilistId, activeCategory, currentSlug, epNum, destroyHls, pathname, router, searchParams, autoplay, captionsEnabled, commitPlaybackSessionToStorageLog, isExternalMedia]);

  // --- NATIVE MOVIE/TV STREAM PIPELINE (no iframe, no third-party embed) ---
  useEffect(() => {
    if (!isExternalMedia) return;

    let cancelled = false;

    async function runExternal() {
      try {
        setLoading(true);
        setError(null);
        setExternalStreamUrl(null);
        setStatus(isExternalMovie ? "Locating movie stream..." : "Locating episode stream...");
        destroyHls();

        // Movie and TV requests must stay on the TMDB Embed API. The anime
        // backend has no matching provider data for these titles.
        const tmdbId = anilistId.replace(/^tmdb-(?:movie|tv)-/i, "");
        if (!/^\d+$/.test(tmdbId)) {
          throw new Error("This title is missing its TMDB ID, so its movie/TV providers cannot be queried.");
        }

        let enabledProviders: string[] = [];
        try {
          const providersRes = await fetch(`${TMDB_EMBED_API}/api/providers`);
          const providersData = providersRes.ok ? await providersRes.json() : null;
          enabledProviders = Array.isArray(providersData?.providers)
            ? providersData.providers
              .filter((item: any) => item?.enabled && item?.name)
              .map((item: any) => String(item.name))
            : [];
          if (!cancelled) setAvailableProviders(enabledProviders);
        } catch {
          // The aggregate endpoint below can still answer if provider status
          // is temporarily unavailable.
        }

        const selectedProvider = enabledProviders.includes(provider) ? provider : enabledProviders[0];
        if (selectedProvider && selectedProvider !== provider) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("provider", selectedProvider);
          router.replace(`${pathname}?${params.toString()}`);
          return;
        }

        const streamPath = isExternalMovie
          ? `movie/${tmdbId}`
          : `series/${tmdbId}?season=${encodeURIComponent(seasonNum)}&episode=${encodeURIComponent(epNum)}`;
        const endpoint = selectedProvider
          ? `${TMDB_EMBED_API}/api/streams/${encodeURIComponent(selectedProvider)}/${streamPath}`
          : `${TMDB_EMBED_API}/api/streams/${streamPath}`;

        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(`Stream lookup failed: ${res.status} ${res.statusText}`);

        const data = await res.json();
        
        // TMDB Embed API responds with { success, streams: [...] }, not the
        // anime API's { sources: [...] } shape. Prefer HLS/VixSrc, then a
        // browser-playable MP4, matching the selection used by the working
        // standalone player.
        const streams = Array.isArray(data?.streams) ? data.streams : [];
        const playableStreams = streams.filter((stream: any) => {
          const url = String(stream?.url || "");
          const label = String(stream?.name || stream?.title || stream?.provider || "").toLowerCase();
          return url && !/\.mkv(?:$|[?#])/i.test(url) && !label.includes("mpv player") && !label.includes("all players");
        });
        const chosenStream = playableStreams.find((stream: any) =>
          /vixsrc/i.test(String(stream?.name || stream?.title || stream?.provider || "")) ||
          /\.m3u8(?:$|[?#])/i.test(String(stream?.url || ""))
        ) ?? playableStreams.find((stream: any) => /\.mp4(?:$|[?#])/i.test(String(stream?.url || "")));
        const streamUrl = chosenStream?.url ? String(chosenStream.url) : null;

        if (!streamUrl) {
          const reason = data?.message || data?.error || "No browser-playable stream returned by the enabled providers.";
          throw new Error(reason);
        }
        if (cancelled || !videoRef.current) return;

        setExternalStreamUrl(streamUrl);
        setEpisodeTitle(isExternalMovie ? "Full Feature Film" : `Episode ${epNum}`);

        const isHlsStream = streamUrl.includes(".m3u8");

        if (isHlsStream) {
          const { default: Hls } = await import("hls.js");
          if (cancelled || !videoRef.current) return;

          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: false });
            hlsRef.current = hls;
            hls.loadSource(streamUrl);
            hls.attachMedia(videoRef.current);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (cancelled) return;
              setLoading(false);
              setStatus("Playback ready");
              if (autoplay) videoRef.current?.play().catch(() => {});
            });

            hls.on(Hls.Events.ERROR, (_: any, errData: any) => {
              if (errData.fatal && !cancelled) {
                setError("Playback failed. Try reloading.");
                setLoading(false);
              }
            });
          } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
            videoRef.current.src = streamUrl;
            videoRef.current.addEventListener("loadedmetadata", () => {
              if (cancelled) return;
              setLoading(false);
              setStatus("Playback ready");
              if (autoplay) videoRef.current?.play().catch(() => {});
            }, { once: true });
          } else {
            throw new Error("Browser does not support HLS playback.");
          }
        } else {
          // Direct progressive file (e.g. .mp4) — feed straight to the native player.
          videoRef.current.src = streamUrl;
          videoRef.current.load();
          videoRef.current.addEventListener("loadedmetadata", () => {
            if (cancelled) return;
            setLoading(false);
            setStatus("Playback ready");
            if (autoplay) videoRef.current?.play().catch(() => {});
          }, { once: true });
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? "Failed to load stream for this title.");
          setLoading(false);
        }
      }
    }

    runExternal();
    return () => { cancelled = true; };
  }, [isExternalMedia, isExternalMovie, anilistId, seasonNum, epNum, destroyHls, autoplay, mediaType, urlProvider, provider, pathname, router, searchParams]);

  const totalEpisodesCount = episodes.length;
  const chunkRanges: { start: number; end: number; label: string }[] = [];

  if (totalEpisodesCount > 30) {
    const step = totalEpisodesCount > 110 ? 100 : 30;
    for (let i = 0; i < totalEpisodesCount; i += step) {
      const s = i + 1, e = Math.min(i + step, totalEpisodesCount);
      chunkRanges.push({ start: s, end: e, label: `${s}-${e}` });
    }
  }

  useEffect(() => {
    if (!chunkRanges.length) return;
    const n = parseFloat(epNum);
    const idx = chunkRanges.findIndex((r) => n >= r.start && n <= r.end);
    if (idx !== -1) setActiveRangeIndex(idx);
  }, [epNum, episodes]);

  const currentDisplayedEpisodes =
    chunkRanges.length > 0
      ? episodes.slice(chunkRanges[activeRangeIndex].start - 1, chunkRanges[activeRangeIndex].end)
      : episodes;

  const cleanDescription = (html?: string) => {
    if (!html) return "No description available.";
    return html.replace(/<\/?[^>]+(>|$)/g, "");
  };

  const parsedEpNum = parseFloat(epNum);
  const hasPrevEpisode = episodes.some((e) => Number(e.number) < parsedEpNum);
  const hasNextEpisodeElement = episodes.some((e) => Number(e.number) > parsedEpNum);

  useEffect(() => {
    if (!isPlaying || episodes.length === 0 || !anilistId || anilistId === "0") return;

    const prefetchTimer = setTimeout(() => {
      const nextNum = parsedEpNum + 1;
      const nextEp = episodes.find((e) => Number(e.number) === nextNum);
      if (!nextEp) return;

      const nextSlug = (nextEp as any).slug ?? (nextEp as any).id;
      if (!nextSlug) return;

      const cacheKey = `${anilistId}:${activeCategory}:${nextNum}`;
      const existing = loadSourceCache();
      if (existing[cacheKey] && Date.now() - (existing[cacheKey].cachedAt || 0) < SOURCE_CACHE_TTL_MS) {
        return; 
      }

      fetch(`${BACKEND_API}/watch/${provider}/${anilistId}/${activeCategory}/${encodeURIComponent(nextSlug)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          const url = data?.results?.bestStream?.url ?? data?.bestStream?.url;
          const ref = data?.results?.bestStream?.referer ?? data?.bestStream?.referer;
          const subs = data?.results?.subtitles ?? data?.subtitles ?? [];
          if (!url) return;

          const fresh = loadSourceCache();
          fresh[cacheKey] = {
            streamUrl: url,
            referer: ref || "https://kwik.cx/",
            selectedProvider: provider,
            subtitles: Array.isArray(subs) ? subs : [],
            cachedAt: Date.now(),
          };
          saveSourceCache(fresh);
        })
        .catch(() => {});
    }, 5000); 

    return () => clearTimeout(prefetchTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, episodes, anilistId, activeCategory, provider]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased pb-20 selection:bg-orange-500 selection:text-white overflow-x-hidden pt-24 px-6 md:px-12">
      
      {!showControls && isPlaying && isFullscreen && (
        <style dangerouslySetInnerHTML={{__html: `
          * { cursor: none !important; }
        `}} />
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes netflixCountdown {
          0% { width: 0%; }
          100% { width: 100%; }
        }
        .animate-netflix-countdown {
          animation: netflixCountdown ${SKIP_COUNTDOWN_DURATION}ms linear forwards;
        }
        .mobile-expand-hitbox {
          position: relative;
        }
        .mobile-expand-hitbox::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          min-width: 64px;
          min-height: 64px;
          width: 180%;
          height: 180%;
          cursor: pointer;
        }

        .custom-sandbox-fullscreen {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 99999 !important;
          border-radius: 0px !important;
          margin: 0px !important;
          background: #000000 !important;
        }

        input[type="range"] {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          touch-action: manipulation;
        }

        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: #f97316;
          border: 2px solid rgba(255,255,255,0.95);
          box-shadow: 0 0 0 3px rgba(249,115,22,0.2);
          cursor: pointer;
        }

        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: #f97316;
          border: 2px solid rgba(255,255,255,0.95);
          box-shadow: 0 0 0 3px rgba(249,115,22,0.2);
          cursor: pointer;
        }
      `}} />

      <header className="fixed top-0 inset-x-0 h-16 bg-gradient-to-b from-black/90 to-transparent backdrop-blur-md z-50 flex items-center justify-between px-6 md:px-12 border-b border-neutral-900/40">
        <div className="flex items-center space-x-12">
          <Link href="/" className="text-2xl font-black tracking-tighter text-orange-500 hover:opacity-90 transition">
            STREAMANIME
          </Link>
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-neutral-400">
            <Link href="/" className="transition hover:text-neutral-200">Home</Link>
            <Link href="/?feed=upcoming" className="transition hover:text-neutral-200">Upcoming</Link>
            <Link href="/?feed=recommendations" className="transition hover:text-neutral-200">Recommendations</Link>
            <Link href="/?feed=popular" className="transition hover:text-neutral-200">Popular</Link>
          </nav>
        </div>

        <div className="flex items-center space-x-6 flex-1 justify-end">
          <div className="relative max-w-xs w-full hidden sm:block ml-6">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <img src="/Assets/search-icon.png" alt="Search" className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90" />
            </div>
            <input
              type="text"
              placeholder="Search titles, genres..."
              onClick={() => router.push("/")}
              className="w-full pl-10 pr-4 py-1.5 rounded-md bg-neutral-900/90 border border-neutral-800 text-sm placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:bg-neutral-900 transition duration-200 cursor-pointer"
            />
          </div>

          {currentProfile && (
            <div className="relative group flex items-center">
              <button 
                onClick={handleSignOutAction}
                className="flex items-center space-x-2 focus:outline-none cursor-pointer group"
                title="Click to Switch Profile / Sign Out"
              >
                <div className="w-8 h-8 rounded bg-neutral-800 overflow-hidden border border-neutral-700 group-hover:border-orange-500 transition duration-200 shadow-md">
                  <img 
                    src={currentProfile.avatar_url} 
                    alt={currentProfile.name} 
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                  />
                </div>
                <span className="hidden lg:inline text-xs font-semibold text-neutral-400 group-hover:text-white transition max-w-[90px] truncate">
                  {currentProfile.name}
                </span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto space-y-6">

        <div className="flex items-center justify-between border-b border-neutral-900 pb-3">
          <Link href={`/anime/${anilistId}`} className="text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-orange-500 transition">
            Back to Catalog Info
          </Link>
          <span className="text-xs font-mono text-white font-bold truncate max-w-md">{animeTitle}</span>
        </div>

        <div
          ref={playerContainerRef}
          onMouseMove={triggerControlsActivity}
          onTouchStart={triggerControlsActivity}
          className={`relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800/60 group shadow-[0_0_50px_rgba(0,0,0,0.8)] transition-all duration-300 ring-1 ring-white/5 select-none ${
            isFullscreen ? "custom-sandbox-fullscreen" : ""
          }`}
        >
          {loading && (
            <div className="absolute inset-0 z-40 overflow-hidden">
              {episodeSnapshot && (
                <div
                  className="absolute inset-0 bg-cover bg-center scale-110 blur-md opacity-40"
                  style={{ backgroundImage: `url(${episodeSnapshot})` }}
                  aria-hidden="true"
                />
              )}
              <div className="absolute inset-0 bg-neutral-950/70" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-orange-500 border-t-transparent" />
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950 z-40 p-6 text-center space-y-2">
              <div className="text-xs text-red-400 font-mono bg-neutral-900 border border-neutral-800 px-5 py-3 rounded max-w-md shadow-inner">
                {error}
              </div>
            </div>
          )}

          <video
            ref={videoRef}
            onClick={handleVideoClick}
            onDoubleClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const isRightSide = clickX > rect.width / 2;
              skipSeconds(isRightSide ? 10 : -10);
              setSeekFlash({ side: isRightSide ? "right" : "left", key: Date.now() });
              window.setTimeout(() => setSeekFlash(null), 500);
            }}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={() => {
              if (videoRef.current?.duration) {
                const totalDur = videoRef.current.duration;
                setDuration(totalDur);
                commitPlaybackSessionToStorageLog(videoRef.current.currentTime, totalDur);
                if (totalDur > 60 && !isNaN(totalDur) && skipIntervals.length === 0 && !isExternalMedia) {
                  fetchTimestampsFromAniSkip(totalDur);
                }
              }
            }}
            onPlay={() => {
              setIsPlaying(true);
              setLoading(false);
              setStatus("Playback ready");
            }}
            onPause={() => setIsPlaying(false)}
            onWaiting={() => {
              setLoading(true);
              setStatus("Buffering...");
            }}
            onCanPlay={() => {
              setLoading(false);
              setStatus("Playback ready");
            }}
            onLoadedMetadata={() => {
              setLoading(false);
              setStatus("Playback ready");
            }}
            onEnded={navigateToNextEpisode}
            onProgress={() => {
              const v = videoRef.current;
              if (!v || !v.duration) return;
              const ranges = v.buffered;
              if (ranges.length > 0) {
                const bufferedEnd = ranges.end(ranges.length - 1);
                setBufferedPercent((bufferedEnd / v.duration) * 100);
              }
            }}
            controls={false}
            playsInline
            className={`w-full h-full cursor-pointer bg-black ${isCropFill ? "object-cover" : "object-contain"}`}
            crossOrigin="anonymous"
          >
            {subtitleTracks.map((t, i) => (
              <track
                key={t.url}
                kind="subtitles"
                src={t.url}
                srcLang={t.language}
                label={t.label}
                default={captionsEnabled && (t.isDefault || i === 0)}
              />
            ))}
          </video>

          {seekFlash && (
            <div
              key={seekFlash.key}
              className={`absolute top-0 bottom-0 w-1/2 z-20 flex items-center pointer-events-none ${
                seekFlash.side === "right" ? "right-0 justify-end pr-8 sm:pr-16" : "left-0 justify-start pl-8 sm:pl-16"
              }`}
            >
              <div className="flex flex-col items-center gap-1 animate-[seekFlash_0.5s_ease-out]">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 flex items-center justify-center text-xl sm:text-2xl">
                  {seekFlash.side === "right" ? "⏩" : "⏪"}
                </div>
                <span className="text-xs font-mono font-bold text-neutral-200">10s</span>
              </div>
            </div>
          )}
          <style jsx>{`
            @keyframes seekFlash {
              0% { opacity: 0; transform: scale(0.85); }
              25% { opacity: 1; transform: scale(1); }
              100% { opacity: 0; transform: scale(1); }
            }
          `}</style>
          <style jsx global>{`
            * {
              -webkit-tap-highlight-color: transparent;
            }
            a, button, input[type="range"] {
              touch-action: manipulation;
            }
          `}</style>


          <div 
            className={`absolute top-0 inset-x-0 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 sm:p-6 pb-14 z-30 transition-all duration-300 pointer-events-none flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              showControls ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
            }`}
          >
            <div className="text-sm md:text-base font-bold text-neutral-100 tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] truncate max-w-xl pointer-events-none">
              {epNum}. {episodeTitle || `Episode ${epNum}`}
            </div>

            <div className="flex items-center space-x-4 self-end sm:self-auto justify-end ml-auto pointer-events-auto">
              <div className="flex items-center space-x-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-neutral-800/40">
                <button onClick={toggleMute} className="mobile-expand-hitbox text-[10px] font-mono font-bold text-neutral-400 hover:text-neutral-200 transition tracking-wider">
                  {isMuted ? "UNMUTE" : "VOLUME"}
                </button>
                <input
                  type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} onChange={handleVolumeChange}
                  className="w-16 sm:w-20 h-1 bg-neutral-800 appearance-none cursor-pointer accent-orange-500 rounded-full" />
              </div>

              <button
                onClick={() => applyCaptionMode(!captionsEnabled)}
                className={`mobile-expand-hitbox hover:scale-105 active:scale-95 flex items-center justify-center outline-none bg-black/40 border border-neutral-800/30 p-2 rounded-lg backdrop-blur-md transition duration-200 ${
                  captionsEnabled ? "opacity-100" : "opacity-40"
                }`}
                title={captionsEnabled ? "Disable Captions" : "Enable Captions"}
              >
                <img 
                  src="/Assets/caption.png" 
                  alt="Captions Toggle"
                  style={{ width: "18px", height: "18px", filter: "invert(1) brightness(2)" }}
                  className="object-contain"
                />
              </button>
            </div>
          </div>

          <div 
            className={`absolute inset-0 flex items-center justify-center z-30 transition-all duration-300 pointer-events-none gap-12 sm:gap-20 ${
              showControls ? "opacity-100 scale-100" : "opacity-0 scale-95"
            }`}
          >
            <button
              onClick={() => skipSeconds(-10)}
              className="pointer-events-auto mobile-expand-hitbox w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-full bg-transparent hover:bg-black/20 border border-transparent hover:border-neutral-800/30 transition duration-200 group/btn transform hover:scale-110 active:scale-90 shadow-none backdrop-blur-none"
              title="Rewind 10 Seconds"
            >
              <img
                src="/Assets/backward-10.png"
                alt="Rewind 10 Seconds"
                style={{ width: "48px", height: "48px" }}
                className="object-contain invert brightness-200 contrast-200"
              />
            </button>

            <button
              onClick={togglePlay}
              className="pointer-events-auto mobile-expand-hitbox w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center bg-transparent text-white transition-all duration-200 transform hover:scale-110 active:scale-95 filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
              title={isPlaying ? "Pause" : "Play"}
            >
              <img
                src={isPlaying ? "/Assets/pause.png" : "/Assets/play.png"}
                alt="Playback Status"
                style={{ 
                  width: isPlaying ? "44px" : "48px", 
                  height: isPlaying ? "44px" : "48px",
                  marginLeft: isPlaying ? "0px" : "6px" 
                }}
                className="object-contain invert brightness-200 contrast-200"
              />
            </button>

            <button
              onClick={() => skipSeconds(10)}
              className="pointer-events-auto mobile-expand-hitbox w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-full bg-transparent hover:bg-black/20 border border-transparent hover:border-neutral-800/30 transition duration-200 group/btn transform hover:scale-110 active:scale-90 shadow-none backdrop-blur-none"
              title="Fast Forward 10 Seconds"
            >
              <img
                src="/Assets/forward-10.png"
                alt="Fast Forward 10 Seconds"
                style={{ width: "48px", height: "48px" }}
                className="object-contain invert brightness-200 contrast-200"
              />
            </button>
          </div>

          {captionsEnabled && currentCaption && (
            <div className="absolute inset-x-4 bottom-28 md:bottom-32 flex items-center justify-center pointer-events-none z-30 text-center">
              <p className="px-4 py-1.5 rounded bg-black/85 text-white font-sans font-medium text-sm sm:text-base md:text-lg lg:text-xl tracking-wide max-w-[85%] border border-neutral-900/40 shadow-xl drop-shadow-md whitespace-pre-line leading-relaxed">
                {currentCaption}
              </p>
            </div>
          )}

          {currentActiveSkip && showSkipButton && !loading && (
            <button
              onClick={executeManualSkipSegment}
              className="absolute bottom-28 right-8 bg-neutral-900/90 hover:bg-black text-white font-sans font-bold text-sm tracking-wide px-7 py-3.5 rounded border border-neutral-700/60 shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-md transition-all duration-200 transform hover:scale-105 active:scale-95 z-30 overflow-hidden flex items-center justify-center min-w-[140px]"
            >
              <div className="absolute top-0 bottom-0 left-0 bg-neutral-950/60 animate-netflix-countdown pointer-events-none mix-blend-multiply" />
              <span className="relative z-10 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-ping" />
                {currentActiveSkip.skipType === "op" ? "Skip Intro" : "Skip Outro"}
              </span>
            </button>
          )}

          <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent p-4 sm:p-6 pt-20 flex flex-col transition-all duration-300 z-40 pointer-events-none ${
            showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          } ${isFullscreen ? "space-y-5 pb-8" : "space-y-3"}`}>
            
            <div className="relative w-full flex items-center h-4 group/timeline pointer-events-auto">
              <div className="absolute left-0 right-0 h-1.5 bg-neutral-800/60 rounded-full flex overflow-hidden">
                {duration > 0 && skipIntervals.length > 0 ? (
                  (() => {
                    const timelineElements: React.ReactNode[] = [];
                    let lastPosition = 0;
                    const sortedIntervals = [...skipIntervals].sort((a, b) => a.interval.startTime - b.interval.startTime);

                    sortedIntervals.forEach((item, index) => {
                      const startPercent = (item.interval.startTime / duration) * 100;
                      const endPercent = (item.interval.endTime / duration) * 100;

                      if (startPercent > lastPosition) {
                        timelineElements.push(
                          <div key={`segment-pre-${index}`} className="h-full bg-neutral-800/60" style={{ width: `${startPercent - lastPosition}%` }} />
                        );
                      }
                      timelineElements.push(<div key={`gap-l-${index}`} className="h-full w-[2px] bg-black shrink-0 z-10" />);
                      timelineElements.push(
                        <div key={`segment-skip-${index}`} className="h-full bg-neutral-700/40 relative" style={{ width: `${endPercent - startPercent}%` }} />
                      );
                      timelineElements.push(<div key={`gap-r-${index}`} className="h-full w-[2px] bg-black shrink-0 z-10" />);
                      lastPosition = endPercent;
                    });

                    if (lastPosition < 100) {
                      timelineElements.push(<div key="segment-end" className="h-full bg-neutral-800/60 flex-1" />);
                    }
                    return timelineElements;
                  })()
                ) : (
                  <div className="h-full w-full bg-neutral-800/60" />
                )}
              </div>

              <div
                className="absolute left-0 h-1.5 bg-neutral-600/50 rounded-full pointer-events-none transition-all duration-300"
                style={{ width: `${bufferedPercent}%` }} />

              <div 
                className="absolute left-0 h-1.5 bg-orange-500 rounded-full pointer-events-none transition-all duration-75" 
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />

              <input
                type="range" min={0} max={duration || 100} step={0.1} value={currentTime} onChange={handleScrub}
                className="absolute inset-0 w-full h-full cursor-pointer z-20 rounded-full touch-manipulation" />
            </div>

            <div className="relative flex items-center pointer-events-auto">

              <div className="text-xs font-mono text-neutral-400 tracking-tight shrink-0">
                <span className="text-neutral-100 font-bold bg-neutral-900/60 px-2 py-1 rounded border border-neutral-800/40">{formatTime(currentTime)}</span>
                <span className="mx-2 text-neutral-700">/</span>
                <span>{formatTime(duration)}</span>
              </div>

              {isFullscreen && (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-1.5">
                  <ToggleSwitch checked={autoplay} onChange={toggleAutoplayState} label="Autoplay" compact />

                  <div className="w-px h-4 bg-neutral-800" />

                  <ToggleSwitch checked={autoskip} onChange={toggleAutoskipState} label="Auto-Skip" compact />

                  <div className="w-px h-4 bg-neutral-800" />

                  <ToggleSwitch checked={autonext} onChange={toggleAutonextState} label="Auto-Next" compact />

                  <div className="w-px h-4 bg-neutral-800" />

                  <button
                    onClick={navigateToNextEpisode} disabled={!hasNextEpisodeElement}
                    className="mobile-expand-hitbox px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-neutral-950 text-white disabled:text-neutral-600 border border-orange-400/20 disabled:border-neutral-800/40 font-mono font-bold text-[10px] tracking-wider uppercase transition active:scale-95 shadow-md flex items-center gap-1"
                  >
                    Next Ep &rarr;
                  </button>

                  <div className="w-px h-4 bg-neutral-800" />

                  <button
                    onClick={toggleCropFill}
                    className={`mobile-expand-hitbox px-3 py-1.5 rounded-lg font-mono font-bold text-[10px] tracking-wider uppercase transition active:scale-95 flex items-center gap-1 ${isCropFill ? "bg-orange-500 text-white" : "bg-neutral-900/60 text-neutral-300 hover:text-white"}`}
                    title={isCropFill ? "Fit to Screen" : "Fill Screen"}
                  >
                    {isCropFill ? "Fill" : "Fit"}
                  </button>
                </div>
              )}

              <button
                onClick={toggleFullscreen}
                className="mobile-expand-hitbox ml-auto p-2 bg-transparent hover:bg-neutral-800/20 border border-transparent hover:border-neutral-800/30 rounded-lg transition active:scale-95 flex items-center justify-center shrink-0"
                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
              >
                <img 
                  src="/Assets/full-screen.png" 
                  alt={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                  style={{ width: "20px", height: "20px" }}
                  className="object-contain invert brightness-200 contrast-200"
                />
              </button>

            </div>
          </div>
        </div>

        <div className="w-full bg-neutral-900/40 py-1.5 px-4 rounded-xl border border-neutral-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-md backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-6 text-xs font-mono text-neutral-300">
            <ToggleSwitch checked={autoplay} onChange={toggleAutoplayState} label="Autoplay" />
            <ToggleSwitch checked={autoskip} onChange={toggleAutoskipState} label="Auto-Skip" />
            <ToggleSwitch checked={autonext} onChange={toggleAutonextState} label="Auto-Next" />
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-auto">
            <button
              onClick={navigateToPrevEpisode}
              disabled={!hasPrevEpisode}
              className="mobile-expand-hitbox px-3 py-1 rounded-md bg-neutral-950 border border-neutral-900 text-neutral-400 hover:text-neutral-200 disabled:opacity-20 disabled:hover:text-neutral-400 font-mono font-bold text-[10px] tracking-wider uppercase transition active:scale-95"
            >
              &larr; Prev
            </button>
            <button
              onClick={navigateToNextEpisode}
              disabled={!hasNextEpisodeElement}
              className="mobile-expand-hitbox px-3 py-1 rounded-md bg-neutral-950 border border-neutral-900 text-neutral-400 hover:text-neutral-200 disabled:opacity-20 disabled:hover:text-neutral-400 font-mono font-bold text-[10px] tracking-wider uppercase transition active:scale-95"
            >
              Next &rarr;
            </button>
            <button
              onClick={handleDownload}
              disabled={downloadProgress !== null}
              title={downloadedFlag ? "Saved to your Downloads" : "Download this episode"}
              className={`mobile-expand-hitbox px-3 py-1 rounded-md bg-neutral-950 border font-mono font-bold text-[10px] tracking-wider uppercase transition active:scale-95 ${
                downloadedFlag && downloadProgress === null
                  ? "border-orange-500/40 text-orange-500"
                  : "border-neutral-900 text-neutral-400 hover:text-orange-500 hover:border-orange-500/40"
              } disabled:active:scale-100`}
            >
              {downloadProgress === null
                ? downloadedFlag ? "✓ Downloaded" : "↓ Download"
                : downloadProgress === -1
                ? "Downloading..."
                : downloadProgress === 100
                ? "✓ Saved"
                : `${downloadProgress}%`}
            </button>
          </div>
        </div>

        <div className="w-full bg-neutral-900/40 border border-neutral-900 rounded-xl overflow-hidden shadow-xl backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 items-start">
            <div className="flex flex-col">
              <div className="text-white text-lg md:text-xl tracking-tight leading-tight">
                <span className="font-black">Episode {epNum}:</span> <span className="font-medium text-neutral-200">{episodeTitle || "Broadcast Segment"}</span>
              </div>
              <div className="text-[11px] font-mono text-neutral-500 font-medium tracking-wide mt-4">
                Air Date: Oct 2024
              </div>
            </div>

            <div className="flex items-center gap-4 md:justify-end">
              <div className="flex flex-col space-y-1 w-full sm:w-40">
                <label className="text-[9px] font-mono font-bold tracking-wider text-neutral-500 uppercase">
                  Audio Track
                </label>
                <select
                  value={activeCategory}
                  onChange={(e) => handleCategoryChange(e.target.value as "sub" | "dub")}
                  className="w-full bg-neutral-950 border border-neutral-800 text-neutral-200 px-3 py-2 rounded text-xs font-mono font-bold focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  <option value="sub">Subtitled</option>
                  <option value="dub" disabled={!hasDubAvailable}>
                    Dubbed {!hasDubAvailable ? "(N/A)" : ""}
                  </option>
                </select>
              </div>

              <div className="flex flex-col space-y-1 w-full sm:w-44">
                <label className="text-[9px] font-mono font-bold tracking-wider text-neutral-500 uppercase">
                  Routing Cluster
                </label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 text-neutral-200 px-3 py-2 rounded text-xs font-mono font-bold focus:outline-none focus:border-orange-500 cursor-pointer"
                >
                  {availableProviders.map((pKey) => (
                    <option key={pKey} value={pKey}>
                      Server {pKey.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mx-6 border-b border-neutral-800/80" />

          <div className="p-6">
            <p className="text-xs md:text-sm text-neutral-400 leading-relaxed text-justify whitespace-pre-line">
              {episodeDesc ? cleanDescription(episodeDesc) : "Stream successfully parsed and synchronized."}
            </p>
          </div>
        </div>

        <div className="space-y-6 pt-6 border-t border-neutral-900">
          <div className="border-b border-neutral-900 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-200">Episode Selection</h2>
              <div className="text-[10px] font-mono text-neutral-600">{totalEpisodesCount} episodes</div>
            </div>
            <div className="flex items-center bg-neutral-900 border border-neutral-800 p-1 rounded space-x-1 self-start sm:self-auto">
              {(["compact", "detailed", "cinematic"] as ViewStyle[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setViewStyle(v)}
                  className={`px-3 py-1.5 rounded text-[10px] font-mono tracking-tight transition capitalize ${
                    viewStyle === v ? "bg-orange-500 text-white font-bold shadow" : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-8 items-start">
            {chunkRanges.length > 0 && (
              <div className="w-full lg:w-48 shrink-0 flex lg:flex-col flex-wrap gap-1 bg-neutral-900/30 border border-neutral-900 p-2 rounded">
                <div className="text-[9px] font-mono tracking-wider text-neutral-600 uppercase p-2 hidden lg:block border-b border-neutral-900 mb-1">
                  Indices Filter
                </div>
                {chunkRanges.map((range, index) => (
                  <button
                    key={range.label}
                    onClick={() => setActiveRangeIndex(index)}
                    className={`flex-1 lg:flex-initial text-left px-3 py-2 rounded text-[11px] font-mono transition-all border ${
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
                    const epSlug = ep.id.includes("/") ? ep.id.split("/").pop() : ep.id;
                    const isActive = Number(ep.number) === parseFloat(epNum);
                    const href = `/watch?provider=${provider}&id=${anilistId}&category=${activeCategory}&slug=${encodeURIComponent(epSlug || "")}&epNum=${ep.number}&type=${mediaType}`;

                    if (viewStyle === "compact") {
                      return (
                        <Link key={ep.id} href={href} className={`border py-3.5 rounded text-center transition block ${
                          isActive ? "bg-orange-500/20 border-orange-500/60 text-orange-500 font-extrabold shadow" : "bg-neutral-900/50 border-neutral-900 hover:border-neutral-700 text-neutral-300 hover:text-orange-500"
                        }`}>
                          <span className="text-xs">{ep.number}</span>
                        </Link>
                      );
                    }

                    if (viewStyle === "detailed") {
                      return (
                        <Link key={ep.id} href={href} className={`border p-4 rounded transition block text-left space-y-1 ${
                          isActive ? "bg-orange-500/10 border-orange-500/40" : "bg-neutral-900/50 border-neutral-900 hover:border-neutral-700"
                        }`}>
                          <div className={`font-bold text-xs truncate ${isActive ? "text-orange-500" : "text-neutral-200 hover:text-orange-500"}`}>
                            Episode {ep.number}{ep.title ? ` — ${ep.title}` : ""}
                          </div>
                          <p className="text-[10px] text-neutral-500 line-clamp-1 leading-normal">
                            {ep.description ? cleanDescription(ep.description) : "No description available."}
                          </p>
                        </Link>
                      );
                    }

                    return (
                      <Link key={ep.id} href={href} className={`border rounded overflow-hidden transition flex h-28 md:h-32 group text-left ${
                        isActive ? "bg-orange-500/10 border-orange-500/40" : "bg-neutral-900/40 border-neutral-900 hover:border-neutral-800"
                      }`}>
                        <div className="w-1/3 h-full shrink-0 relative bg-neutral-900 border-r border-neutral-900 overflow-hidden">
                          <img
                            src={ep.image || "https://placehold.co/300x180?text=Episode"}
                            alt={`Episode ${ep.number}`}
                            className="w-full h-full object-cover transition duration-500 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                          <div className="absolute bottom-2 left-3 bg-orange-500 text-white font-mono font-black text-[10px] px-1.5 py-0.5 rounded shadow-lg">
                            EP {ep.number}
                          </div>
                        </div>
                        <div className="p-4 flex-1 min-w-0 flex flex-col justify-center space-y-1.5">
                          <h3 className={`font-bold text-xs md:text-sm truncate leading-tight ${isActive ? "text-orange-500" : "text-neutral-200 group-hover:text-orange-500"}`}>
                            {ep.title || `Episode ${ep.number}`}
                          </h3>
                          <p className="text-[11px] text-neutral-400 line-clamp-2 md:line-clamp-3 leading-relaxed">
                            {ep.description ? cleanDescription(ep.description) : "No description available."}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-neutral-900/10 border border-neutral-900/60 rounded-lg p-12 text-center max-w-sm mx-auto">
                  <p className="text-neutral-500 font-semibold text-xs">No episodes found</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
        Loading Player...
      </div>
    }>
      <WatchContent />
    </Suspense>
  );
}

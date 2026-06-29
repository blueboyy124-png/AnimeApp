"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase, SupabaseProfile } from "../utils/supabase";

const BACKEND_API = process.env.NEXT_PUBLIC_API_URL ?? "https://anime-api-one-cyan.vercel.app/api";

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
  const [currentTime,     setCurrentTime]     = useState(0);
  const [duration,        setDuration]        = useState(0);
  const [volume,          setVolume]          = useState(1);
  const [isMuted,         setIsMuted]         = useState(false);
  const [isFullscreen,    setIsFullscreen]    = useState(false);
  const [showControls,    setShowControls]    = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [currentCaption,  setCurrentCaption]  = useState<string>("");

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

  const urlProvider = searchParams.get("provider");
  const anilistId   = searchParams.get("anilistId") ?? "0";
  const category    = searchParams.get("category");
  const rawSlug     = searchParams.get("slug")       ?? "";
  const epNum       = searchParams.get("epNum")      ?? "1";

  const currentSlug = rawSlug
    ? (rawSlug.includes("watch/") ? rawSlug.split("/").pop() ?? rawSlug : rawSlug)
    : "";

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
    router.push(`${pathname}?${p.toString()}`);
  }, [episodes, epNum, searchParams, pathname, router]);

  const navigateToPrevEpisode = useCallback(() => {
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
    router.push(`${pathname}?${p.toString()}`);
  }, [episodes, epNum, searchParams, pathname, router]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    isPlaying ? videoRef.current.pause() : videoRef.current.play().catch(() => {});
    triggerControlsActivity();
  };

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

  const handleCategoryChange = (target: "sub" | "dub") => {
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

  const handleSignOutAction = () => {
    localStorage.removeItem("streamanime_active_profile_id");
    localStorage.removeItem("streamanime_watch_history");
    window.location.reload();
  };

  const commitPlaybackSessionToStorageLog = useCallback(async (current: number, total: number) => {
    if (!anilistId || anilistId === "0" || !total || total <= 0) return;
    try {
      const storageKey = "streamanime_watch_history";
      const raw = localStorage.getItem(storageKey);
      let list: any[] = raw ? JSON.parse(raw) : [];
      
      list = list.filter(
        (item: any) =>
          !(String(item.anilistId) === String(anilistId) &&
            String(item.episodeNumber) === String(epNum))
      );

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

      const activeId = localStorage.getItem("streamanime_active_profile_id");
      if (activeId) {
        await supabase
          .from("profiles")
          .update({ recent_episodes: optimizedHistorySlice })
          .eq("id", activeId);
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
    if (!id || isNaN(id) || isNaN(exactSeconds) || exactSeconds <= 60) {
      return;
    }

    const applyConventionalFallbackIntervals = () => {
      const isFirstEpisode = Math.floor(epFloat) === 1;
      const fallbackSet: any[] = [];

      if (!isFirstEpisode && exactSeconds > 300) {
        fallbackSet.push({
          skipType: "op",
          interval: {
            startTime: 90,
            endTime: 180,
          },
          skipId: "fallback-op",
          episodeLength: exactSeconds
        });
      }

      if (exactSeconds > 240) {
        fallbackSet.push({
          skipType: "ed",
          interval: {
            startTime: exactSeconds - 120,
            endTime: exactSeconds - 30,
          },
          skipId: "fallback-ed",
          episodeLength: exactSeconds
        });
      }

      setSkipIntervals(fallbackSet);
    };

    try {
      const infoRes = await fetch(`${BACKEND_API}/info/${id}`);
      if (!infoRes.ok) { applyConventionalFallbackIntervals(); return; }
      const infoData = await infoRes.json();

      let malId =
        infoData?.results?.malId  ??
        infoData?.results?.idMal  ??
        infoData?.malId           ??
        infoData?.idMal           ??
        infoData?.results?.mal_id ??
        infoData?.mal_id;

      if (!malId) { applyConventionalFallbackIntervals(); return; }

      const numericMalId = parseInt(String(malId), 10);
      let targetedMalId = numericMalId;
      let targetedEpisode = Math.floor(epFloat);

      if (numericMalId === 21) {
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

      const skipUrl = `https://api.aniskip.com/v2/skip-times/${targetedMalId}/${targetedEpisode}?types=op&types=ed&episodeLength=${exactSeconds}`;
      const skipRes = await fetch(skipUrl);
      
      if (skipRes.status === 404) {
        applyConventionalFallbackIntervals();
        return;
      }

      if (skipRes.ok) {
        const skipData = await skipRes.json();
        if (skipData.found && Array.isArray(skipData.results)) {
          setSkipIntervals(skipData.results);
        } else {
          applyConventionalFallbackIntervals();
        }
      } else {
        applyConventionalFallbackIntervals();
      }
    } catch (skipErr) {
      applyConventionalFallbackIntervals();
    }
  }, [anilistId, epNum]);

  useEffect(() => {
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

        const fallbackQueue = Array.from(new Set([
          provider,
          ...STABILITY_PRIORITY,
          ...(epData ? Object.keys(epData?.results?.providers || epData?.providers || {}) : []),
        ]));

        for (const provKey of fallbackQueue) {
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

            if (!url) {
              const streams = (data?.results?.streams ?? data?.streams ?? []) as any[];
              const chosen = streams.find((s) => s.type === "hls" && s.url);
              if (chosen) { url = chosen.url; if (chosen.referer) ref = chosen.referer; }
            }

            if (url) {
              targetStreamUrl  = url;
              if (ref) targetReferer = ref;
              selectedProvider = provKey;
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

        if (selectedProvider !== provider) {
          const p = new URLSearchParams(searchParams.toString());
          p.set("provider", selectedProvider);
          router.replace(`${pathname}?${p.toString()}`);
        }

        let initialTime = 0;
        if (savedTimeRef.current > 0) {
          initialTime = savedTimeRef.current;
          savedTimeRef.current = 0;
        } else {
          try {
            const raw = localStorage.getItem("streamanime_watch_history");
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
            if (initialTime > 0 && videoRef.current) {
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
            if (initialTime > 0 && videoRef.current) videoRef.current.currentTime = initialTime;
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
  }, [provider, anilistId, activeCategory, currentSlug, epNum, destroyHls, pathname, router, searchParams, autoplay, captionsEnabled, commitPlaybackSessionToStorageLog]);

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

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased pb-20 selection:bg-orange-500 selection:text-white overflow-x-hidden pt-24 px-6 md:px-12">
      
      {!showControls && isPlaying && isFullscreen && (
        <style dangerouslySetInnerHTML={{__html: `
          * { cursor: none !important; }
        `}} />
      )}

      {/* RE-ENGINEERED COMPACT PREMIUM STYLING RULES */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes netflixCountdown {
          0% { width: 0%; }
          100% { width: 100%; }
        }
        .animate-netflix-countdown {
          animation: netflixCountdown ${SKIP_COUNTDOWN_DURATION}ms linear forwards;
        }
        video::-webkit-media-text-track-container {
          display: none !important;
        }
        video::cue {
          color: transparent !important;
          background: transparent !important;
        }
        
        /* 48x48px Clean Interactive Mobile Touch Box Extension */
        .mobile-expand-hitbox {
          position: relative;
        }
        .mobile-expand-hitbox::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          min-width: 48px;
          min-height: 48px;
          width: 140%;
          height: 140%;
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

        {/* INTEGRATED THEATRE VIEWPORT SYSTEM */}
        <div
          ref={playerContainerRef}
          onMouseMove={triggerControlsActivity}
          onTouchStart={triggerControlsActivity}
          className={`relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-neutral-800/60 group shadow-[0_0_50px_rgba(0,0,0,0.8)] transition-all duration-300 ring-1 ring-white/5 select-none ${
            isFullscreen ? "custom-sandbox-fullscreen" : ""
          }`}
        >
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/95 z-40 space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-orange-500 border-t-transparent" />
              <p className="text-xs uppercase tracking-widest text-neutral-400 font-mono font-medium animate-pulse">{status}</p>
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
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={() => {
              if (videoRef.current?.duration) {
                const totalDur = videoRef.current.duration;
                setDuration(totalDur);
                commitPlaybackSessionToStorageLog(videoRef.current.currentTime, totalDur);
                if (totalDur > 60 && !isNaN(totalDur) && skipIntervals.length === 0) {
                  fetchTimestampsFromAniSkip(totalDur);
                }
              }
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={navigateToNextEpisode}
            controls={false}
            playsInline
            webkit-playsinline="true"
            className="w-full h-full object-contain cursor-pointer bg-black"
          />

          {/* PREMIUM TOP HUD OVERLAY PANEL (Title + New Audio Tracks & Volumetric Slider) */}
          <div 
            className={`absolute top-0 inset-x-0 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 sm:p-6 pb-14 z-30 transition-all duration-300 pointer-events-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              showControls ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
            }`}
          >
            <div className="text-sm md:text-base font-bold text-neutral-100 tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] truncate max-w-xl">
              {epNum}. {episodeTitle || `Episode ${epNum}`}
            </div>

            {/* Shifted rightwards via justify-end and tracking utilities */}
            <div className="flex items-center space-x-6 self-end sm:self-auto justify-end ml-auto">
              {/* Desktop & Mobile Responsive Top Volume Hud Block */}
              <div className="flex items-center space-x-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-neutral-800/40">
                <button onClick={toggleMute} className="mobile-expand-hitbox text-[10px] font-mono font-bold text-neutral-400 hover:text-neutral-200 transition tracking-wider">
                  {isMuted ? "UNMUTE" : "VOLUME"}
                </button>
                <input
                  type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} onChange={handleVolumeChange}
                  className="w-16 sm:w-20 h-1 bg-neutral-800 appearance-none cursor-pointer accent-orange-500 rounded-full" />
              </div>

              {/* Dynamic Action Access Button standard layout */}
              <button
                onClick={() => {
                  const nextMode = !captionsEnabled;
                  setCaptionsEnabled(nextMode);
                  if (videoRef.current) {
                    const textTracks = videoRef.current.textTracks;
                    for (let i = 0; i < textTracks.length; i++) {
                      textTracks[i].mode = nextMode ? "showing" : "hidden";
                    }
                  }
                }}
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

              <button
                onClick={toggleFullscreen}
                className="mobile-expand-hitbox hover:scale-105 active:scale-95 flex items-center justify-center outline-none bg-black/40 border border-neutral-800/30 p-2 rounded-lg backdrop-blur-md transition duration-200"
                title="Toggle Fullscreen"
              >
                <img 
                  src="/Assets/full-screen.png" 
                  alt="Fullscreen Toggle"
                  style={{ width: "16px", height: "16px" }}
                  className="object-contain invert brightness-200 contrast-200 opacity-100"
                />
              </button>
            </div>
          </div>

          {/* CENTERED KINETIC CONTROLS PLATFORM - NO ROUNDED CIRCLE BACKGROUND BACKGROUND, LARGER SIZE */}
          <div 
            className={`absolute inset-0 flex items-center justify-center z-30 transition-all duration-300 pointer-events-auto gap-8 sm:gap-14 ${
              showControls ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
            }`}
          >
            {/* Rewind 10s Trigger */}
            <button
              onClick={() => skipSeconds(-10)}
              className="mobile-expand-hitbox w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 border border-neutral-800/60 transition duration-200 group/btn transform hover:scale-110 active:scale-90 shadow-lg backdrop-blur-sm"
              title="Rewind 10 Seconds"
            >
              <span className="font-mono text-xs font-bold text-neutral-300 group-hover/btn:text-white tracking-tighter flex flex-col items-center">
                <span className="text-[15px] sm:text-[17px] leading-none mb-0.5">&larr;</span>
                <span className="text-[10px] uppercase font-bold tracking-tight">10s</span>
              </span>
            </button>

            {/* Core Center Play / Pause Cluster - Enlarged + Transparent Minimalist Background Wrapper */}
            <button
              onClick={togglePlay}
              className="mobile-expand-hitbox w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center bg-transparent text-white transition-all duration-200 transform hover:scale-110 active:scale-95 filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
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

            {/* Fast Forward 10s Trigger */}
            <button
              onClick={() => skipSeconds(10)}
              className="mobile-expand-hitbox w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 border border-neutral-800/60 transition duration-200 group/btn transform hover:scale-110 active:scale-90 shadow-lg backdrop-blur-sm"
              title="Fast Forward 10 Seconds"
            >
              <span className="font-mono text-xs font-bold text-neutral-300 group-hover/btn:text-white tracking-tighter flex flex-col items-center">
                <span className="text-[15px] sm:text-[17px] leading-none mb-0.5">&rarr;</span>
                <span className="text-[10px] uppercase font-bold tracking-tight">10s</span>
              </span>
            </button>
          </div>

          {/* MASTER SUBTITLE RENDER CONTAINER */}
          {captionsEnabled && currentCaption && (
            <div className="absolute inset-x-4 bottom-28 md:bottom-32 flex items-center justify-center pointer-events-none z-30 text-center">
              <p className="px-4 py-1.5 rounded bg-black/85 text-white font-sans font-medium text-sm sm:text-base md:text-lg lg:text-xl tracking-wide max-w-[85%] border border-neutral-900/40 shadow-xl drop-shadow-md whitespace-pre-line leading-relaxed">
                {currentCaption}
              </p>
            </div>
          )}

          {/* ANI-SKIP DESCRIPTOR FLOATING TRIGGER BUTTON */}
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

          {/* STREAM DECK BASE LOWER TIMELINEHUD BLOCK */}
          <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent p-4 sm:p-6 pt-20 flex flex-col transition-all duration-300 z-20 pointer-events-auto ${
            showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
          } ${isFullscreen ? "space-y-5 pb-8" : "space-y-3"}`}>
            
            {/* TIMELINE TIMESTEP TRACKBAR CONTAINER */}
            <div className="relative w-full flex items-center h-4 group/timeline">
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
                className="absolute left-0 h-1.5 bg-orange-500 rounded-full pointer-events-none transition-all duration-75" 
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />

              <input
                type="range" min={0} max={duration || 100} step={0.1} value={currentTime} onChange={handleScrub}
                className="absolute w-full h-full opacity-0 cursor-pointer z-20" />
            </div>

            {/* DYNAMIC METRIC DISPATCH AND MULTI-MODE ACTION FOOTER */}
            <div className="flex items-center justify-between">
              {/* Left Segment: Standard Playback Session Timers */}
              <div className="text-xs font-mono text-neutral-400 tracking-tight">
                <span className="text-neutral-100 font-bold bg-neutral-900/60 px-2 py-1 rounded border border-neutral-800/40">{formatTime(currentTime)}</span>
                <span className="mx-2 text-neutral-700">/</span>
                <span>{formatTime(duration)}</span>
              </div>

              {/* Right Segment: Fullscreen Button or Expanded Controls Menu */}
              {isFullscreen ? (
                /* INJECTED INTEGRATED COMBINATORIAL EMBEDDED BUTTON SET (AUTOPLAY, SKIP, AUTONEXT, NEXT EPISODE) */
                <div className="flex items-center bg-neutral-900/90 border border-neutral-800/80 p-1.5 rounded-xl space-x-1.5 shadow-xl backdrop-blur-md">
                  <label className="mobile-expand-hitbox flex items-center space-x-2 px-3 py-1.5 rounded-lg hover:bg-neutral-800/40 cursor-pointer select-none group text-xs font-mono text-neutral-300">
                    <input
                      type="checkbox" checked={autoplay} onChange={toggleAutoplayState}
                      className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-950 text-orange-500 focus:ring-0 cursor-pointer accent-orange-500" />
                    <span className="group-hover:text-white transition hidden sm:inline">Autoplay</span>
                  </label>

                  <div className="w-px h-4 bg-neutral-800" />

                  <label className="mobile-expand-hitbox flex items-center space-x-2 px-3 py-1.5 rounded-lg hover:bg-neutral-800/40 cursor-pointer select-none group text-xs font-mono text-neutral-300">
                    <input
                      type="checkbox" checked={autoskip} onChange={toggleAutoskipState}
                      className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-950 text-orange-500 focus:ring-0 cursor-pointer accent-orange-500" />
                    <span className="group-hover:text-white transition hidden sm:inline">Auto-Skip</span>
                  </label>

                  <div className="w-px h-4 bg-neutral-800" />

                  <label className="mobile-expand-hitbox flex items-center space-x-2 px-3 py-1.5 rounded-lg hover:bg-neutral-800/40 cursor-pointer select-none group text-xs font-mono text-neutral-300">
                    <input
                      type="checkbox" checked={autonext} onChange={toggleAutonextState}
                      className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-950 text-orange-500 focus:ring-0 cursor-pointer accent-orange-500" />
                    <span className="group-hover:text-white transition hidden sm:inline">Auto-Next</span>
                  </label>

                  <div className="w-px h-4 bg-neutral-800" />

                  <button
                    onClick={navigateToNextEpisode} disabled={!hasNextEpisodeElement}
                    className="mobile-expand-hitbox px-3.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-neutral-950 text-white disabled:text-neutral-600 border border-orange-400/20 disabled:border-neutral-800/40 font-mono font-bold text-[10px] tracking-wider uppercase transition active:scale-95 shadow-md flex items-center gap-1"
                  >
                    Next Ep &rarr;
                  </button>
                </div>
              ) : (
                /* INJECTED RELOCATED FULLSCREEN TRIGGER (REPLACES THE OLD CINEMA ENGINE TEXT STRIP) */
                <button
                  onClick={toggleFullscreen}
                  className="mobile-expand-hitbox px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg text-[10px] font-mono font-bold tracking-wider text-neutral-300 hover:text-white uppercase transition active:scale-95 shadow flex items-center gap-2"
                  title="Enter Fullscreen"
                >
                  <img 
                    src="/Assets/full-screen.png" 
                    alt="Cinema Size"
                    style={{ width: "11px", height: "11px" }}
                    className="object-contain invert brightness-200 contrast-200"
                  />
                  Cinema View
                </button>
              )}
            </div>
          </div>
        </div>

        {/* DEFAULT COMPACT STANDARD FOOTER OPTIONS DECK */}
        <div className="w-full bg-neutral-900/40 py-1.5 px-4 rounded-xl border border-neutral-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-md backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-6 text-xs font-mono text-neutral-300">
            <label className="mobile-expand-hitbox flex items-center space-x-2.5 cursor-pointer select-none group relative py-1">
              <input
                type="checkbox"
                checked={autoplay}
                onChange={toggleAutoplayState}
                className="w-3.5 h-3.5 rounded border-neutral-800 bg-neutral-950 text-orange-500 focus:ring-0 focus:ring-offset-0 checked:bg-orange-500 cursor-pointer accent-orange-500"
              />
              <span className="group-hover:text-neutral-100 transition">Autoplay</span>
            </label>

            <label className="mobile-expand-hitbox flex items-center space-x-2.5 cursor-pointer select-none group relative py-1">
              <input
                type="checkbox"
                checked={autoskip}
                onChange={toggleAutoskipState}
                className="w-3.5 h-3.5 rounded border-neutral-800 bg-neutral-950 text-orange-500 focus:ring-0 focus:ring-offset-0 checked:bg-orange-500 cursor-pointer accent-orange-500"
              />
              <span className="group-hover:text-neutral-100 transition">Auto-Skip</span>
            </label>

            <label className="mobile-expand-hitbox flex items-center space-x-2.5 cursor-pointer select-none group relative py-1">
              <input
                type="checkbox"
                checked={autonext}
                onChange={toggleAutonextState}
                className="w-3.5 h-3.5 rounded border-neutral-800 bg-neutral-950 text-orange-500 focus:ring-0 focus:ring-offset-0 checked:bg-orange-500 cursor-pointer accent-orange-500"
              />
              <span className="group-hover:text-neutral-100 transition">Auto-Next</span>
            </label>
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
                    const href = `/watch?provider=${provider}&anilistId=${anilistId}&category=${activeCategory}&slug=${encodeURIComponent(epSlug || "")}&epNum=${ep.number}`;

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
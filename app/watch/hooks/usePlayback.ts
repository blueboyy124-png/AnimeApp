import { useState, useRef, useCallback, useEffect } from "react";
import { MAX_VOLUME } from "../lib/constants";

interface UsePlaybackOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playerContainerRef: React.RefObject<HTMLDivElement | null>;
  setLoading: (v: boolean) => void;
  setStatus: (v: string) => void;
  setError: (v: string | null) => void;
  onTimeUpdateCallback?: (time: number, duration: number) => void;
  onCaptionChange?: (caption: string) => void;
  onSkipCheck?: (time: number) => void;
}

export function usePlayback({
  videoRef,
  playerContainerRef,
  setLoading,
  setStatus,
  setError,
  onTimeUpdateCallback,
  onCaptionChange,
  onSkipCheck,
}: UsePlaybackOptions) {
  const [isPlaying,          setIsPlaying]          = useState(false);
  const [currentTime,        setCurrentTime]        = useState(0);
  const [duration,           setDuration]           = useState(0);
  const [bufferedPercent,    setBufferedPercent]    = useState(0);
  const [volume,             setVolume]             = useState(1);
  const [isMuted,            setIsMuted]            = useState(false);
  const [isFullscreen,       setIsFullscreen]       = useState(false);
  const [showControls,       setShowControls]       = useState(true);
  const [captionsEnabled,    setCaptionsEnabled]    = useState(true);
  const [subtitleTracks,     setSubtitleTracks]     = useState<Array<{ url: string; label: string; language: string; isDefault?: boolean }>>([]);
  const [currentCaption,     setCurrentCaption]     = useState<string>("");
  const [playbackRate,       setPlaybackRate]       = useState(1);
  const [videoQuality,       setVideoQuality]       = useState<string>("Auto");
  const [seekFlash,          setSeekFlash]          = useState<{ side: "left" | "right"; key: number } | null>(null);
  const [isPiPActive,        setIsPiPActive]        = useState(false);
  const [isCropFill,         setIsCropFill]         = useState(false);
  const [showSettingsMenu,   setShowSettingsMenu]   = useState(false);
  const [showVolumeSlider,   setShowVolumeSlider]   = useState(false);

  const [autoplay,           setAutoplay]           = useState<boolean>(true);
  const [autoskip,           setAutoskip]           = useState<boolean>(false);
  const [autonext,           setAutonext]           = useState<boolean>(true);

  const audioContextRef        = useRef<AudioContext | null>(null);
  const audioSourceRef         = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef            = useRef<GainNode | null>(null);
  const lastVolumeRef          = useRef<number>(1);
  const controlsTimeoutRef     = useRef<number | null>(null);
  const volumeSliderTimeoutRef = useRef<number | null>(null);
  const settingsMenuRef        = useRef<HTMLDivElement | null>(null);
  const volumeControlRef       = useRef<HTMLDivElement | null>(null);

  const lastRenderedSecondRef  = useRef(-1);
  const lastCaptionTextRef     = useRef("");

  // Load preferences from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedAutoplay = localStorage.getItem("streamanime_autoplay");
      const storedAutoskip = localStorage.getItem("streamanime_autoskip");
      const storedAutonext = localStorage.getItem("streamanime_autonext");
      if (storedAutoplay !== null) setAutoplay(storedAutoplay === "true");
      if (storedAutoskip !== null) setAutoskip(storedAutoskip === "true");
      if (storedAutonext !== null) setAutonext(storedAutonext === "true");
    } catch {}
  }, []);

  const triggerControlsActivity = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = window.setTimeout(() => setShowControls(false), 3500);
    }
  }, [isPlaying]);

  useEffect(() => {
    triggerControlsActivity();
    return () => { if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current); };
  }, [triggerControlsActivity]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (isPlaying) {
      video.pause();
    } else {
      setStatus("Starting playback...");
      if (video.readyState === 0 && video.currentSrc) {
        try { video.load(); } catch {}
      }
      video.play().catch((playError) => {
        const message = playError instanceof Error ? playError.message : String(playError);
        if (playError instanceof DOMException &&
            (playError.name === "AbortError" || playError.name === "NotAllowedError")) {
          setLoading(false);
          setStatus("Ready — tap Play");
          return;
        }
        setLoading(false);
        setError(`Playback could not start on this device: ${message}`);
        setStatus("Playback blocked — tap Play again");
        console.error("[watch] video.play() rejected", playError);
      });
    }
    triggerControlsActivity();
  }, [isPlaying, videoRef, setLoading, setStatus, setError, triggerControlsActivity]);

  const handleVideoClick = useCallback(() => {
    if (showControls) {
      setShowControls(false);
      if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
    }
  }, [showControls]);

  const skipSeconds = useCallback((amount: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + amount));
    triggerControlsActivity();
  }, [videoRef, triggerControlsActivity]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const t = parseFloat(e.target.value);
    videoRef.current.currentTime = t;
    setCurrentTime(t);
    triggerControlsActivity();
  }, [videoRef, triggerControlsActivity]);

  const applyCaptionMode = useCallback(async (enabled: boolean) => {
  setCaptionsEnabled(enabled);
  if (!videoRef.current) return;

  // 1. First, do your original job of showing/hiding normal tracks
  const tracks = videoRef.current.textTracks;
  for (let i = 0; i < tracks.length; i += 1) {
    tracks[i].mode = enabled ? "showing" : "hidden";
  }

  // 2. NEW: If there are no built-in tracks, turn on the AI listener instead!
  if (tracks.length === 0 && enabled) {
    // Dynamically load the AI tool
    const Moonshine = await import("https://jsdelivr.net");
    
    // Set up the AI to listen to your videoRef
    const videoCaptioner = new Moonshine.VideoCaptioner(videoRef.current, "model/tiny", false);
    
    // Start generating captions instantly!
    videoCaptioner.start();
  }
}, [videoRef]);


  const ensureAudioGraph = useCallback(() => {
    if (audioContextRef.current || !videoRef.current) return;
    try {
      const AudioContextCtor = ((window as any).AudioContext || (window as any).webkitAudioContext) as
        | (typeof AudioContext)
        | undefined;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const source = ctx.createMediaElementSource(videoRef.current);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      audioContextRef.current = ctx;
      audioSourceRef.current = source;
      gainNodeRef.current = gain;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch {
      // Boosting unavailable — 0–100% still works natively.
    }
  }, [videoRef]);

  const setVolumeLevel = useCallback((raw: number) => {
    const video = videoRef.current;
    if (!video) return;
    const v = Math.round(Math.max(0, Math.min(MAX_VOLUME, raw)) * 100) / 100;

    setVolume(v);
    setIsMuted(v === 0);
    if (v > 0) lastVolumeRef.current = v;

    if (gainNodeRef.current) {
      video.volume = 1;
      video.muted = false;
      gainNodeRef.current.gain.value = v;
      return;
    }

    if (v > 1) {
      ensureAudioGraph();
      const gainNode = gainNodeRef.current as GainNode | null;
      if (gainNode) {
        video.volume = 1;
        video.muted = false;
        gainNode.gain.value = v;
        return;
      }
      video.volume = 1;
      video.muted = false;
      return;
    }

    video.volume = v;
    video.muted = v === 0;
  }, [ensureAudioGraph, videoRef]);

  const toggleMute = useCallback(() => {
    if (isMuted || volume === 0) {
      setVolumeLevel(lastVolumeRef.current > 0 ? lastVolumeRef.current : 1);
    } else {
      setVolumeLevel(0);
    }
  }, [isMuted, volume, setVolumeLevel]);

  const togglePictureInPicture = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture();
      }
    } catch {}
  }, [videoRef]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnter = () => setIsPiPActive(true);
    const onLeave = () => setIsPiPActive(false);
    v.addEventListener("enterpictureinpicture", onEnter);
    v.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      v.removeEventListener("enterpictureinpicture", onEnter);
      v.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [videoRef]);

  const applyPlaybackRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setShowSettingsMenu(false);
  }, [videoRef]);

  // Cross-platform fullscreen:
  //  1. Native Fullscreen API on the whole player container — Chrome, Firefox,
  //     Edge, Safari desktop, Android. Keeps our overlay controls/subtitles
  //     usable and hides the browser/OS chrome. Esc exits for free.
  //  2. Vendor-prefixed WebKit fullscreen for older Safari desktop builds.
  //  3. CSS sandbox fallback (`.custom-sandbox-fullscreen`) — iOS Safari has no
  //     fullscreen API for arbitrary elements (only plain <video>, which would
  //     drop our custom subtitles/skip overlays), so we pin the player over the
  //     viewport instead. Also catches any weird rejection path.
  //
  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    const container = playerContainerRef.current;

    const isNativeFull = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement
    );

    // Currently fullscreen — exit
    if (isNativeFull) {
      try {
        const doc = document as any;
        await (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.();
      } catch {}
      setIsFullscreen(false);
      triggerControlsActivity();
      return;
    }

    // iOS Safari or no native API — use CSS sandbox fallback
    if (!container || typeof container.requestFullscreen !== "function") {
      setIsFullscreen(true);
      triggerControlsActivity();
      return;
    }

    // Enter native fullscreen
    try {
      await container.requestFullscreen();
      setIsFullscreen(true);
    } catch {
      // Fallback to CSS sandbox if native fails
      setIsFullscreen(true);
    }
    triggerControlsActivity();
  }, [triggerControlsActivity, playerContainerRef]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const syncFullscreenState = () => {
      const isCurrentlyFull = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement
      );
      setIsFullscreen(isCurrentlyFull);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (volumeSliderTimeoutRef.current) window.clearTimeout(volumeSliderTimeoutRef.current);
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  const scrollPositionRef = useRef(0);
  const wasFullscreenRef = useRef(false);

  useEffect(() => {
    // Lock scroll while fullscreened (matters most for the iOS sandbox path,
    // where the page behind the fixed player could otherwise still scroll).
    // We save the scroll position on the way in and restore it on the way
    // out — this effect also runs once on mount with isFullscreen still
    // false, so it must not touch scroll position in that case.
    const html = document.documentElement;
    const body = document.body;
    if (isFullscreen) {
      if (!wasFullscreenRef.current) {
        scrollPositionRef.current = window.scrollY;
      }
      body.style.overflow = "hidden";
      html.style.overflow = "hidden";
    } else {
      body.style.overflow = "";
      html.style.overflow = "";
      if (wasFullscreenRef.current) {
        window.scrollTo({ top: scrollPositionRef.current, behavior: "instant" as ScrollBehavior });
      }
    }
    wasFullscreenRef.current = isFullscreen;
    return () => {
      body.style.overflow = "";
      html.style.overflow = "";
    };
  }, [isFullscreen]);

  const revealVolumeSlider = useCallback(() => {
    if (volumeSliderTimeoutRef.current) window.clearTimeout(volumeSliderTimeoutRef.current);
    setShowVolumeSlider(true);
  }, []);

  const scheduleHideVolumeSlider = useCallback(() => {
    if (volumeSliderTimeoutRef.current) window.clearTimeout(volumeSliderTimeoutRef.current);
    volumeSliderTimeoutRef.current = window.setTimeout(() => setShowVolumeSlider(false), 250);
  }, []);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (showSettingsMenu && settingsMenuRef.current && !settingsMenuRef.current.contains(target)) {
        setShowSettingsMenu(false);
      }
      if (showVolumeSlider && volumeControlRef.current && !volumeControlRef.current.contains(target)) {
        setShowVolumeSlider(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showSettingsMenu, showVolumeSlider]);

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
          setVolumeLevel((isMuted ? 0 : volume) + 0.1);
          break;
        case "arrowdown":
          e.preventDefault();
          setVolumeLevel((isMuted ? 0 : volume) - 0.1);
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
  }, [isMuted, volume, setVolumeLevel, toggleMute, toggleFullscreen, togglePlay, skipSeconds]);

  const toggleAutoplayState = useCallback(() => {
    setAutoplay((prev) => {
      const next = !prev;
      try { localStorage.setItem("streamanime_autoplay", String(next)); } catch {}
      return next;
    });
  }, []);

  const toggleAutoskipState = useCallback(() => {
    setAutoskip((prev) => {
      const next = !prev;
      try { localStorage.setItem("streamanime_autoskip", String(next)); } catch {}
      return next;
    });
  }, []);

  const toggleAutonextState = useCallback(() => {
    setAutonext((prev) => {
      const next = !prev;
      try { localStorage.setItem("streamanime_autonext", String(next)); } catch {}
      return next;
    });
  }, []);

  const toggleCropFill = useCallback(() => {
    setIsCropFill((prev) => !prev);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    const wholeSecond = Math.floor(time);
    if (wholeSecond !== lastRenderedSecondRef.current) {
      lastRenderedSecondRef.current = wholeSecond;
      setCurrentTime(time);
    }

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
      if (activeCueText !== lastCaptionTextRef.current) {
        lastCaptionTextRef.current = activeCueText;
        setCurrentCaption(activeCueText);
        onCaptionChange?.(activeCueText);
      }
    }

    onTimeUpdateCallback?.(time, videoRef.current.duration || 0);
    onSkipCheck?.(time);
  }, [onCaptionChange, onSkipCheck, onTimeUpdateCallback, videoRef]);

  return {
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    bufferedPercent,
    setBufferedPercent,
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    isFullscreen,
    setIsFullscreen,
    showControls,
    setShowControls,
    captionsEnabled,
    setCaptionsEnabled,
    subtitleTracks,
    setSubtitleTracks,
    currentCaption,
    setCurrentCaption,
    playbackRate,
    setPlaybackRate,
    videoQuality,
    setVideoQuality,
    seekFlash,
    setSeekFlash,
    isPiPActive,
    isCropFill,
    showSettingsMenu,
    setShowSettingsMenu,
    showVolumeSlider,
    setShowVolumeSlider,
    autoplay,
    setAutoplay,
    autoskip,
    setAutoskip,
    autonext,
    setAutonext,
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
  };
}
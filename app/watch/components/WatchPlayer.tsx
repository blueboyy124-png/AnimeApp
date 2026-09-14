import React from "react";
import PlayerSettings from "./PlayerSettings";
import PlayerControls from "./PlayerControls";
import SkipButton from "./SkipButton";
import { invalidateFailedSource } from "../lib/sourceCache";
import type { SkipIntervalItem } from "../hooks/useSkipIntervals";

export interface WatchPlayerProps {
  playerContainerRef: React.RefObject<HTMLDivElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  triggerControlsActivity: () => void;
  isFullscreen: boolean;
  loading: boolean;
  setLoading: (l: boolean) => void;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: (s: string) => void;
  episodeSnapshot: string;
  onRetryEpisode: () => void;
  handleVideoClick: () => void;
  skipSeconds: (amount: number) => void;
  seekFlash: { side: "left" | "right"; key: number } | null;
  setSeekFlash: (f: { side: "left" | "right"; key: number } | null) => void;
  playbackHasStartedRef: React.MutableRefObject<boolean>;
  playbackSourceReadyRef: React.MutableRefObject<boolean>;
  mediaProgressHandlerRef: React.MutableRefObject<(() => void) | null>;
  mediaSuccessHandlerRef: React.MutableRefObject<(() => void) | null>;
  mediaFailureHandlerRef: React.MutableRefObject<(() => void) | null>;
  stallRecoveryTimerRef: React.MutableRefObject<number | null>;
  activeSourceUrlRef: React.MutableRefObject<string | null>;
  provider: string;
  subtitleTracks: Array<{ url: string; label: string; language: string; isDefault?: boolean }>;
  isCropFill: boolean;
  playbackHasStarted: boolean;
  setPlaybackHasStarted: (s: boolean) => void;
  isPlaying: boolean;
  setIsPlaying: (p: boolean) => void;
  duration: number;
  setDuration: (d: number) => void;
  setBufferedPercent: (b: number) => void;
  setVideoQuality: (q: string) => void;
  skipIntervals: SkipIntervalItem[];
  fetchSkipTimestamps: (duration: number) => void;
  commitPlaybackSessionToStorageLog: (time: number, dur: number) => void;
  navigateToNextEpisode: () => void;
  handleTimeUpdate: () => void;
  animeTitle: string;
  episodeTitle: string;
  epNum: string;
  isExternalMovie: boolean;
  captionsEnabled: boolean;
  applyCaptionMode: (enable: boolean) => void;
  isPiPActive: boolean;
  togglePictureInPicture: () => void;
  showSettingsMenu: boolean;
  setShowSettingsMenu: React.Dispatch<React.SetStateAction<boolean>>;
  videoQuality: string;
  playbackRate: number;
  applyPlaybackRate: (rate: number) => void;
  settingsMenuRef: React.RefObject<HTMLDivElement | null>;
  currentCaption: string;
  currentActiveSkip: SkipIntervalItem | null;
  showSkipButton: boolean;
  executeManualSkipSegment: () => void;
  showControls: boolean;
  togglePlay: () => void;
  currentTime: number;
  bufferedPercent: number;
  handleScrub: (e: React.ChangeEvent<HTMLInputElement>) => void;
  formatTime: (s: number) => string;
  volume: number;
  isMuted: boolean;
  setVolumeLevel: (v: number) => void;
  toggleMute: () => void;
  showVolumeSlider: boolean;
  revealVolumeSlider: () => void;
  scheduleHideVolumeSlider: () => void;
  volumeControlRef: React.RefObject<HTMLDivElement | null>;
  toggleFullscreen: () => void;
  toggleCropFill: () => void;
  autoplay: boolean;
  toggleAutoplayState: () => void;
  autoskip: boolean;
  toggleAutoskipState: () => void;
  autonext: boolean;
  toggleAutonextState: () => void;
  hasNextEpisodeElement: boolean;
}

export default function WatchPlayer(props: WatchPlayerProps) {
  const {
    playerContainerRef,
    videoRef,
    triggerControlsActivity,
    isFullscreen,
    loading,
    setLoading,
    error,
    setError,
    setStatus,
    episodeSnapshot,
    onRetryEpisode,
    handleVideoClick,
    skipSeconds,
    seekFlash,
    setSeekFlash,
    playbackHasStartedRef,
    playbackSourceReadyRef,
    mediaProgressHandlerRef,
    mediaSuccessHandlerRef,
    mediaFailureHandlerRef,
    stallRecoveryTimerRef,
    activeSourceUrlRef,
    provider,
    subtitleTracks,
    isCropFill,
    playbackHasStarted,
    setPlaybackHasStarted,
    isPlaying,
    setIsPlaying,
    duration,
    setDuration,
    setBufferedPercent,
    setVideoQuality,
    skipIntervals,
    fetchSkipTimestamps,
    commitPlaybackSessionToStorageLog,
    navigateToNextEpisode,
    handleTimeUpdate,
    animeTitle,
    episodeTitle,
    epNum,
    isExternalMovie,
    captionsEnabled,
    applyCaptionMode,
    isPiPActive,
    togglePictureInPicture,
    showSettingsMenu,
    setShowSettingsMenu,
    videoQuality,
    playbackRate,
    applyPlaybackRate,
    settingsMenuRef,
    currentCaption,
    currentActiveSkip,
    showSkipButton,
    executeManualSkipSegment,
    showControls,
    togglePlay,
    currentTime,
    bufferedPercent,
    handleScrub,
    formatTime,
    volume,
    isMuted,
    setVolumeLevel,
    toggleMute,
    showVolumeSlider,
    revealVolumeSlider,
    scheduleHideVolumeSlider,
    volumeControlRef,
    toggleFullscreen,
    toggleCropFill,
    autoplay,
    toggleAutoplayState,
    autoskip,
    toggleAutoskipState,
    autonext,
    toggleAutonextState,
    hasNextEpisodeElement,
  } = props;

  return (
    <div
      ref={playerContainerRef}
      onMouseMove={triggerControlsActivity}
      onTouchStart={triggerControlsActivity}
      className={`relative w-full aspect-video bg-black overflow-hidden group select-none ${
        isFullscreen ? "custom-sandbox-fullscreen" : "sm:rounded-sm"
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

      {error && !isPlaying && !playbackHasStarted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950 z-40 p-6 text-center gap-3">
          <p className="text-sm text-neutral-300 max-w-sm">
            Something went wrong while loading this episode.
          </p>
          <button
            type="button"
            className="rounded-md bg-white/95 hover:bg-white px-4 py-2 text-sm font-medium text-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            onClick={onRetryEpisode}
          >
            Try again
          </button>
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
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime > 0) {
            mediaProgressHandlerRef.current?.();
            if (stallRecoveryTimerRef.current) {
              window.clearTimeout(stallRecoveryTimerRef.current);
              stallRecoveryTimerRef.current = null;
            }
            if (!playbackHasStartedRef.current) {
              playbackHasStartedRef.current = true;
              setPlaybackHasStarted(true);
              playbackSourceReadyRef.current = true;
            }
            setError((prev) => (prev === null ? prev : null));
          }
          handleTimeUpdate();
        }}
        onDurationChange={() => {
          if (videoRef.current?.duration) {
            const totalDur = videoRef.current.duration;
            setDuration(totalDur);
            commitPlaybackSessionToStorageLog(videoRef.current.currentTime, totalDur);
            if (totalDur > 60 && !isNaN(totalDur) && skipIntervals.length === 0) {
              fetchSkipTimestamps(totalDur);
            }
          }
        }}
        onPlay={() => {
          playbackHasStartedRef.current = true;
          setPlaybackHasStarted(true);
          playbackSourceReadyRef.current = true;
          mediaProgressHandlerRef.current?.();
          if (stallRecoveryTimerRef.current) {
            window.clearTimeout(stallRecoveryTimerRef.current);
            stallRecoveryTimerRef.current = null;
          }
          setIsPlaying(true);
          setLoading(false);
          setError(null);
          setStatus("Playback ready");
        }}
        onPause={() => setIsPlaying(false)}
        onPlaying={() => {
          playbackHasStartedRef.current = true;
          setPlaybackHasStarted(true);
          playbackSourceReadyRef.current = true;
          mediaProgressHandlerRef.current?.();
          mediaSuccessHandlerRef.current?.();
          setIsPlaying(true);
          setLoading(false);
          setError(null);
          setStatus("Playback ready");
          if (stallRecoveryTimerRef.current) {
            window.clearTimeout(stallRecoveryTimerRef.current);
            stallRecoveryTimerRef.current = null;
          }
        }}
        onWaiting={() => {
          setLoading(!playbackSourceReadyRef.current);
          setStatus("Buffering...");
        }}
        onStalled={() => {
          const readyState = videoRef.current?.readyState ?? 0;
          if (playbackHasStartedRef.current || playbackSourceReadyRef.current || readyState >= 2 || (videoRef.current?.currentTime ?? 0) > 0) return;
          setStatus("Stream stalled — retrying source...");
          console.warn("[watch] video stalled", {
            src: videoRef.current?.currentSrc || videoRef.current?.src,
            readyState,
            networkState: videoRef.current?.networkState,
          });
          if (!stallRecoveryTimerRef.current) {
            stallRecoveryTimerRef.current = window.setTimeout(() => {
              stallRecoveryTimerRef.current = null;
              mediaFailureHandlerRef.current?.();
            }, 4500);
          }
        }}
        onError={(event) => {
          const mediaError = event.currentTarget.error;
          const source = event.currentTarget.currentSrc || event.currentTarget.src;
          if (!source || source === window.location.href || source === window.location.href + "#") return;
          if (source.startsWith("blob:")) {
            console.warn("[watch] Ignoring HLS blob media error", { provider, src: source });
            return;
          }
          const activeSource = activeSourceUrlRef.current;
          const normalizedSource = source.startsWith(window.location.origin)
            ? source.slice(window.location.origin.length)
            : source;
          if (!activeSource || (normalizedSource !== activeSource && source !== activeSource)) {
            console.warn("[watch] Ignoring stale media error from previous route", {
              provider,
              src: source,
              activeSource,
            });
            return;
          }
          const detail = mediaError
            ? `code ${mediaError.code}${mediaError.message ? `: ${mediaError.message}` : ""}`
            : "unknown media error";
          setLoading(false);
          const mediaActive = playbackHasStartedRef.current ||
            (!event.currentTarget.paused && event.currentTarget.readyState >= 2);
          if (!mediaActive) setStatus("Source error — trying another provider...");
          const fallback = mediaFailureHandlerRef.current;
          const diagnostic = {
            detail,
            src: source,
            provider,
            readyState: event.currentTarget.readyState,
            networkState: event.currentTarget.networkState,
          };
          if (mediaError?.code === 4) {
            console.warn("[watch] Recoverable HTMLMediaElement error; trying fallback", diagnostic);
            invalidateFailedSource(source);
            fallback?.();
            return;
          }
          if (fallback) {
            console.warn("[watch] Recoverable HTMLMediaElement error; trying fallback", diagnostic);
            fallback();
          } else {
            console.error("[watch] HTMLMediaElement error", diagnostic);
          }
        }}
        onCanPlay={() => {
          playbackSourceReadyRef.current = true;
          if (stallRecoveryTimerRef.current) {
            window.clearTimeout(stallRecoveryTimerRef.current);
            stallRecoveryTimerRef.current = null;
          }
          setLoading(false);
          setError(null);
          setStatus("Playback ready");
        }}
        onLoadedMetadata={() => {
          playbackSourceReadyRef.current = true;
          setLoading(false);
          setError(null);
          setStatus("Playback ready");
          const v = videoRef.current;
          if (v?.videoHeight) setVideoQuality(`${v.videoHeight}p`);
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
        preload="auto"
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
          <div className="flex flex-col items-center gap-1.5 animate-[seekFlash_0.5s_ease-out]">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/40 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                {seekFlash.side === "right" ? (
                  <path d="M5 4l10 8-10 8V4zM19 5v14" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M19 4L9 12l10 8V4zM5 5v14" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </div>
            <span className="text-[11px] font-medium text-neutral-200">10s</span>
          </div>
        </div>
      )}

      {/* TOP CONTROL BAR */}
      <div
        className={`absolute top-0 inset-x-0 bg-gradient-to-b from-black/65 via-black/10 to-transparent p-4 sm:p-6 pb-14 z-30 transition-all duration-200 pointer-events-none flex items-start justify-between gap-3 ${
          showControls ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
        }`}
      >
        <div className="min-w-0 pointer-events-none">
          {!isExternalMovie && (
            <>
              <div className="text-[11px] font-semibold text-neutral-300/80 uppercase tracking-wider truncate">
                {animeTitle}
              </div>
              <div className="text-xs text-neutral-400 mt-0.5">S1 · E{epNum}</div>
            </>
          )}
          <div className="text-base sm:text-lg font-semibold text-white truncate max-w-xl mt-1 tracking-tight leading-snug">
            {isExternalMovie ? (episodeTitle || "Full Feature Film") : episodeTitle || `Episode ${epNum}`}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 pointer-events-auto relative">
          <button
            onClick={() => applyCaptionMode(!captionsEnabled)}
            className={`mobile-expand-hitbox flex items-center justify-center transition-colors duration-150 active:scale-95 ${
              captionsEnabled ? "text-orange-500" : "text-white/90 hover:text-white"
            }`}
            title={captionsEnabled ? "Disable Captions" : "Enable Captions"}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2.5" y="5" width="19" height="14" rx="2" />
              <path d="M8.5 10.2a1.8 1.8 0 00-1.8-1.2c-1.2 0-2 .9-2 2.2v1.6c0 1.3.8 2.2 2 2.2.9 0 1.5-.5 1.8-1.2M16 10.2a1.8 1.8 0 00-1.8-1.2c-1.2 0-2 .9-2 2.2v1.6c0 1.3.8 2.2 2 2.2.9 0 1.5-.5 1.8-1.2" strokeLinecap="round" />
            </svg>
          </button>

          <button
            onClick={togglePictureInPicture}
            className={`mobile-expand-hitbox flex items-center justify-center transition-colors duration-150 active:scale-95 ${
              isPiPActive ? "text-orange-500" : "text-white/90 hover:text-white"
            }`}
            title={isPiPActive ? "Exit Picture-in-Picture" : "Picture-in-Picture"}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <PlayerSettings
            showSettingsMenu={showSettingsMenu}
            setShowSettingsMenu={setShowSettingsMenu}
            videoQuality={videoQuality}
            playbackRate={playbackRate}
            applyPlaybackRate={applyPlaybackRate}
            settingsMenuRef={settingsMenuRef}
          />
        </div>
      </div>

      {/* CENTER & BOTTOM CONTROLS */}
      <PlayerControls
        showControls={showControls}
        isPlaying={isPlaying}
        togglePlay={togglePlay}
        skipSeconds={skipSeconds}
        currentTime={currentTime}
        duration={duration}
        bufferedPercent={bufferedPercent}
        handleScrub={handleScrub}
        formatTime={formatTime}
        skipIntervals={skipIntervals}
        volume={volume}
        isMuted={isMuted}
        setVolumeLevel={setVolumeLevel}
        toggleMute={toggleMute}
        showVolumeSlider={showVolumeSlider}
        revealVolumeSlider={revealVolumeSlider}
        scheduleHideVolumeSlider={scheduleHideVolumeSlider}
        volumeControlRef={volumeControlRef}
        videoQuality={videoQuality}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        isCropFill={isCropFill}
        toggleCropFill={toggleCropFill}
        isExternalMovie={isExternalMovie}
        autoplay={autoplay}
        toggleAutoplayState={toggleAutoplayState}
        autoskip={autoskip}
        toggleAutoskipState={toggleAutoskipState}
        autonext={autonext}
        toggleAutonextState={toggleAutonextState}
        navigateToNextEpisode={navigateToNextEpisode}
        hasNextEpisodeElement={hasNextEpisodeElement}
      />

      {/* CAPTIONS OVERLAY */}
      {captionsEnabled && currentCaption && (
        <div className="absolute inset-x-4 bottom-24 sm:bottom-28 flex items-center justify-center pointer-events-none z-30 text-center">
          <p className="px-3 py-1 rounded bg-black/75 text-white font-medium text-sm sm:text-base md:text-lg max-w-[85%] whitespace-pre-line leading-snug">
            {currentCaption}
          </p>
        </div>
      )}

      {/* SKIP BUTTON */}
      <SkipButton
        showSkipButton={showSkipButton}
        currentActiveSkip={currentActiveSkip}
        loading={loading}
        onSkip={executeManualSkipSegment}
        secondsRemaining={currentActiveSkip ? currentActiveSkip.interval.endTime - currentTime : null}
      />

      <style jsx>{`
        @keyframes seekFlash {
          0% { opacity: 0; transform: scale(0.85); }
          25% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
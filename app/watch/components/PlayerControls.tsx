import React from "react";
import ToggleSwitch from "./ToggleSwitch";
import { MAX_VOLUME } from "../lib/constants";
import type { SkipIntervalItem } from "../hooks/useSkipIntervals";

export interface PlayerControlsProps {
  showControls: boolean;
  isPlaying: boolean;
  togglePlay: () => void;
  skipSeconds: (seconds: number) => void;
  currentTime: number;
  duration: number;
  bufferedPercent: number;
  handleScrub: (e: React.ChangeEvent<HTMLInputElement>) => void;
  formatTime: (s: number) => string;
  skipIntervals: SkipIntervalItem[];
  volume: number;
  isMuted: boolean;
  setVolumeLevel: (v: number) => void;
  toggleMute: () => void;
  showVolumeSlider: boolean;
  revealVolumeSlider: () => void;
  scheduleHideVolumeSlider: () => void;
  volumeControlRef: React.RefObject<HTMLDivElement | null>;
  videoQuality: string;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  isCropFill: boolean;
  toggleCropFill: () => void;
  isExternalMovie: boolean;
  autoplay: boolean;
  toggleAutoplayState: () => void;
  autoskip: boolean;
  toggleAutoskipState: () => void;
  autonext: boolean;
  toggleAutonextState: () => void;
  navigateToNextEpisode: () => void;
  hasNextEpisodeElement: boolean;
}

export default function PlayerControls({
  showControls,
  isPlaying,
  togglePlay,
  skipSeconds,
  currentTime,
  duration,
  bufferedPercent,
  handleScrub,
  formatTime,
  skipIntervals,
  volume,
  isMuted,
  setVolumeLevel,
  toggleMute,
  showVolumeSlider,
  revealVolumeSlider,
  scheduleHideVolumeSlider,
  volumeControlRef,
  videoQuality,
  isFullscreen,
  toggleFullscreen,
  isCropFill,
  toggleCropFill,
  isExternalMovie,
  autoplay,
  toggleAutoplayState,
  autoskip,
  toggleAutoskipState,
  autonext,
  toggleAutonextState,
  navigateToNextEpisode,
  hasNextEpisodeElement,
}: PlayerControlsProps) {
  return (
    <>
      {/* Center Rewind / Play-Pause / Fast-Forward Overlay */}
      <div
        className={`absolute inset-0 flex items-center justify-center z-30 transition-all duration-300 pointer-events-none gap-12 sm:gap-20 ${
          showControls ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <button
          onClick={() => skipSeconds(-10)}
          className="pointer-events-auto mobile-expand-hitbox w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full bg-transparent hover:bg-white/10 transition-colors duration-150 active:scale-90"
          title="Rewind 10 Seconds"
        >
          <img
            src="/Assets/backward-10.png"
            alt="Rewind 10 Seconds"
            style={{ width: "30px", height: "30px" }}
            className="object-contain invert brightness-200 contrast-200 opacity-95"
          />
        </button>

        <button
          onClick={togglePlay}
          className="pointer-events-auto mobile-expand-hitbox w-16 h-16 sm:w-[72px] sm:h-[72px] flex items-center justify-center rounded-full bg-transparent hover:bg-white/10 text-white transition-colors duration-150 active:scale-95"
          title={isPlaying ? "Pause" : "Play"}
        >
          <img
            src={isPlaying ? "/Assets/pause.png" : "/Assets/play.png"}
            alt="Playback Status"
            style={{
              width: isPlaying ? "34px" : "36px",
              height: isPlaying ? "34px" : "36px",
              marginLeft: isPlaying ? "0px" : "3px",
            }}
            className="object-contain invert brightness-200 contrast-200"
          />
        </button>

        <button
          onClick={() => skipSeconds(10)}
          className="pointer-events-auto mobile-expand-hitbox w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full bg-transparent hover:bg-white/10 transition-colors duration-150 active:scale-90"
          title="Fast Forward 10 Seconds"
        >
          <img
            src="/Assets/forward-10.png"
            alt="Fast Forward 10 Seconds"
            style={{ width: "30px", height: "30px" }}
            className="object-contain invert brightness-200 contrast-200 opacity-95"
          />
        </button>
      </div>

      {/* Bottom Controls Bar */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 sm:p-6 pt-16 flex flex-col transition-all duration-200 z-40 pointer-events-none ${
          showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        } ${isFullscreen ? "space-y-4 pb-8" : "space-y-2.5"}`}
      >
        {/* SEEK BAR — runs the full width of the control area on its own */}
        <div className="relative flex items-center h-4 group/timeline pointer-events-auto">
          <div className="absolute left-0 right-0 h-[2px] group-hover/timeline:h-1 transition-all duration-100 bg-white/25 rounded-full flex overflow-hidden">
            {duration > 0 && skipIntervals.length > 0 ? (
              (() => {
                const timelineElements: React.ReactNode[] = [];
                let lastPosition = 0;
                const sortedIntervals = [...skipIntervals].sort(
                  (a, b) => a.interval.startTime - b.interval.startTime
                );

                sortedIntervals.forEach((item, index) => {
                  const startPercent = (item.interval.startTime / duration) * 100;
                  const endPercent = (item.interval.endTime / duration) * 100;

                  if (startPercent > lastPosition) {
                    timelineElements.push(
                      <div
                        key={`segment-pre-${index}`}
                        className="h-full bg-neutral-800/60"
                        style={{ width: `${startPercent - lastPosition}%` }}
                      />
                    );
                  }
                  timelineElements.push(
                    <div key={`gap-l-${index}`} className="h-full w-[2px] bg-black shrink-0 z-10" />
                  );
                  timelineElements.push(
                    <div
                      key={`segment-skip-${index}`}
                      className="h-full bg-neutral-700/40 relative"
                      style={{ width: `${endPercent - startPercent}%` }}
                    />
                  );
                  timelineElements.push(
                    <div key={`gap-r-${index}`} className="h-full w-[2px] bg-black shrink-0 z-10" />
                  );
                  lastPosition = endPercent;
                });

                if (lastPosition < 100) {
                  timelineElements.push(
                    <div key="segment-end" className="h-full bg-neutral-800/60 flex-1" />
                  );
                }
                return timelineElements;
              })()
            ) : (
              <div className="h-full w-full bg-neutral-800/60" />
            )}
          </div>

          <div
            className="absolute left-0 h-[2px] group-hover/timeline:h-1 transition-all duration-100 bg-white/30 rounded-full pointer-events-none"
            style={{ width: `${bufferedPercent}%` }}
          />

          <div
            className="absolute left-0 h-[2px] group-hover/timeline:h-1 transition-all duration-100 bg-orange-500 rounded-full pointer-events-none"
            style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
          />

          {/* Small persistent thumb — grows slightly on hover rather than appearing from nothing */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 group-hover/timeline:w-2.5 group-hover/timeline:h-2.5 rounded-full bg-white pointer-events-none transition-all duration-100"
            style={{ left: `calc(${duration ? (currentTime / duration) * 100 : 0}% - 4px)` }}
          />

          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleScrub}
            aria-label="Seek"
            className="seek-bar-input absolute inset-0 w-full h-full cursor-pointer z-20 rounded-full touch-none appearance-none bg-transparent"
          />
        </div>

        {/* TRANSPORT ROW — play / volume / quality on the left, fullscreen on the right */}
        <div className="relative flex items-center pointer-events-auto">
          <div className="flex items-center gap-4 sm:gap-5">
            <button
              onClick={togglePlay}
              title={isPlaying ? "Pause" : "Play"}
              className="mobile-expand-hitbox flex items-center justify-center text-white hover:text-white/80 active:scale-95 transition-colors"
            >
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Volume */}
            <div
              ref={volumeControlRef}
              className="relative flex items-center"
              onMouseEnter={revealVolumeSlider}
              onMouseLeave={scheduleHideVolumeSlider}
            >
              <button
                onClick={() => {
                  toggleMute();
                  revealVolumeSlider();
                  scheduleHideVolumeSlider();
                }}
                title={isMuted || volume === 0 ? "Unmute" : "Mute"}
                className="mobile-expand-hitbox flex items-center justify-center text-white hover:text-white/80 active:scale-95 transition-colors duration-150"
              >
                {isMuted || volume === 0 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H3v6h3l5 4V5z" />
                    <path d="M17 9l4 6M21 9l-4 6" />
                  </svg>
                ) : volume > 1 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H3v6h3l5 4V5z" />
                    <path d="M15 8.5a5 5 0 010 7M17.5 6a9 9 0 010 12M20 4a13 13 0 010 16" />
                  </svg>
                ) : volume < 0.5 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H3v6h3l5 4V5z" />
                    <path d="M15.5 10a3 3 0 010 4" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H3v6h3l5 4V5z" />
                    <path d="M15.5 8.5a5 5 0 010 7M18.5 6a9 9 0 010 12" />
                  </svg>
                )}
              </button>

              <div
                className={`volume-popover absolute bottom-full left-1/2 mb-4 z-50 ${
                  showVolumeSlider ? "" : "pointer-events-none"
                }`}
                style={{
                  opacity: showVolumeSlider ? 1 : 0,
                  transform: `translate(-50%, ${showVolumeSlider ? "0px" : "6px"}) scale(${
                    showVolumeSlider ? 1 : 0.94
                  })`,
                  transition:
                    "opacity 150ms cubic-bezier(0.22,1,0.36,1), transform 150ms cubic-bezier(0.22,1,0.36,1)",
                }}
                onMouseEnter={revealVolumeSlider}
                onMouseLeave={scheduleHideVolumeSlider}
              >
                <div className="flex flex-col items-center gap-2.5 bg-[#151515]/98 border border-white/10 rounded-full px-2.5 py-3 shadow-lg">
                  <span
                    className={`text-[10px] font-mono font-bold tabular-nums ${
                      volume > 1 ? "text-orange-500" : "text-neutral-300"
                    }`}
                  >
                    {Math.round(volume * 100)}%
                  </span>

                  <div className="relative w-1 h-24 rounded-full bg-neutral-700/70 overflow-visible">
                    {/* Tick marking "true" 100% — the boost zone starts here */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2 w-2.5 h-px bg-neutral-500/80 pointer-events-none"
                      style={{ bottom: `${(1 / MAX_VOLUME) * 100}%` }}
                    />
                    <div
                      className="absolute bottom-0 left-0 w-full rounded-full bg-orange-500 pointer-events-none"
                      style={{
                        height: `${(Math.min(volume, MAX_VOLUME) / MAX_VOLUME) * 100}%`,
                      }}
                    />
                    <div
                      className="absolute left-1/2 w-3 h-3 rounded-full bg-white shadow-md pointer-events-none"
                      style={{
                        bottom: `calc(${
                          (Math.min(volume, MAX_VOLUME) / MAX_VOLUME) * 100
                        }% - 6px)`,
                        transform: "translateX(-50%)",
                      }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={MAX_VOLUME}
                      step={0.01}
                      value={volume}
                      onChange={(e) => setVolumeLevel(parseFloat(e.target.value))}
                      className="volume-vertical-input absolute top-1/2 left-1/2"
                      style={{
                        width: 96,
                        height: 24,
                        transform: "translate(-50%, -50%) rotate(-90deg)",
                      }}
                      aria-label="Volume"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {isFullscreen && (
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4">
              {!isExternalMovie && (
                <>
                  <ToggleSwitch checked={autoplay} onChange={toggleAutoplayState} label="Auto Play" compact />
                  <ToggleSwitch checked={autoskip} onChange={toggleAutoskipState} label="Skip Intro" compact />
                  <ToggleSwitch checked={autonext} onChange={toggleAutonextState} label="Next Ep" compact />

                  <button
                    onClick={navigateToNextEpisode}
                    disabled={!hasNextEpisodeElement}
                    className="mobile-expand-hitbox flex items-center gap-1 text-xs font-medium text-neutral-300 hover:text-white disabled:text-neutral-600 disabled:hover:text-neutral-600 transition-colors active:scale-95"
                  >
                    Next Episode
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </>
              )}

              <button
                onClick={toggleCropFill}
                className={`mobile-expand-hitbox px-2.5 py-1.5 rounded-md text-xs font-medium transition active:scale-95 ${
                  isCropFill ? "text-orange-500" : "text-neutral-300 hover:text-white"
                }`}
                title={isCropFill ? "Fit to Screen" : "Fill Screen"}
              >
                {isCropFill ? "Fill" : "Fit"}
              </button>
            </div>
          )}

          <div className="flex items-center gap-4 sm:gap-5 ml-auto">
            <span className="text-xs font-medium text-neutral-300 tabular-nums hidden xs:inline">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <button
              onClick={toggleFullscreen}
              className="mobile-expand-hitbox flex items-center justify-center text-white hover:text-white/80 active:scale-95 transition-colors"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
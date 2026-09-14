import React from "react";
import type { SkipIntervalItem } from "../hooks/useSkipIntervals";

interface SkipButtonProps {
  showSkipButton: boolean;
  currentActiveSkip: SkipIntervalItem | null;
  loading?: boolean;
  onSkip: () => void;
  secondsRemaining?: number | null;
}

export default function SkipButton({
  showSkipButton,
  currentActiveSkip,
  loading = false,
  onSkip,
  secondsRemaining = null,
}: SkipButtonProps) {
  if (!currentActiveSkip || !showSkipButton || loading) return null;

  return (
    <button
      onClick={onSkip}
      className="absolute bottom-24 sm:bottom-28 right-4 sm:right-6 flex items-center gap-2.5 bg-black/70 hover:bg-black/85 border border-white/15 backdrop-blur-sm text-white font-medium text-[13px] pl-3 pr-3.5 py-2 rounded-md transition-all duration-150 active:scale-[0.97] z-30"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
        <path d="M5 4l10 8-10 8V4zM19 5v14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {currentActiveSkip.skipType === "op" ? "Skip Intro" : "Skip Recap"}
      {typeof secondsRemaining === "number" && secondsRemaining > 0 && (
        <span className="text-neutral-400 font-normal tabular-nums">{Math.ceil(secondsRemaining)}s</span>
      )}
    </button>
  );
}
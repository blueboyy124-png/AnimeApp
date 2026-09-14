import React from "react";

interface PlayerSettingsProps {
  showSettingsMenu: boolean;
  setShowSettingsMenu: React.Dispatch<React.SetStateAction<boolean>>;
  videoQuality: string;
  playbackRate: number;
  applyPlaybackRate: (rate: number) => void;
  settingsMenuRef: React.RefObject<HTMLDivElement | null>;
}

export default function PlayerSettings({
  showSettingsMenu,
  setShowSettingsMenu,
  videoQuality,
  playbackRate,
  applyPlaybackRate,
  settingsMenuRef,
}: PlayerSettingsProps) {
  return (
    <div className="relative" ref={settingsMenuRef}>
      <button
        onClick={() => setShowSettingsMenu((v) => !v)}
        className={`mobile-expand-hitbox flex items-center justify-center transition-colors duration-150 active:scale-95 ${
          showSettingsMenu ? "text-orange-500" : "text-white/90 hover:text-white"
        }`}
        title="Settings"
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-out"
          style={{ transform: showSettingsMenu ? "rotate(45deg)" : "rotate(0deg)" }}
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>

      {showSettingsMenu && (
        <div className="settings-menu-pop absolute top-full right-0 mt-2 w-36 bg-[#151515]/98 border border-white/10 rounded-md shadow-lg overflow-hidden z-50 origin-top-right py-1">
          <div className="px-3 py-1.5 text-[10px] text-neutral-500 flex items-center justify-between">
            <span>Quality</span>
            <span className="text-neutral-300 font-medium">{videoQuality}</span>
          </div>
          <div className="mx-3 my-1 border-t border-white/10" />
          <div className="px-3 pt-1 pb-1 text-[10px] text-neutral-500">Speed</div>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
            <button
              key={rate}
              onClick={() => applyPlaybackRate(rate)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors duration-150 ${
                playbackRate === rate
                  ? "text-orange-500 font-semibold"
                  : "text-neutral-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              {rate === 1 ? "Normal" : `${rate}x`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
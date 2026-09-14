import React from "react";

// Animated switch — replaces the old checkbox inputs. 180ms transition on
// both the track color and the thumb position keeps it feeling snappy
// without being distracting mid-playback.
export default function ToggleSwitch({
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
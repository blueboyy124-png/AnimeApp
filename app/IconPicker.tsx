"use client";

import { useEffect, useState } from "react";

interface IconPickerProps {
  value: string;
  onChange: (iconUrl: string) => void;
}

// Grid of selectable avatar icons, sourced from /Assets/icons via the
// /api/icons route. Drop new image files in public/Assets/icons and they
// show up here automatically — no code change needed.
export default function IconPicker({ value, onChange }: IconPickerProps) {
  const [icons, setIcons] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/icons")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setIcons(data.icons || []);
        // Default to the first available icon if nothing's selected yet.
        if (!value && data.icons?.length) onChange(data.icons[0]);
      })
      .catch(() => { if (!cancelled) setIcons([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-orange-500 border-t-transparent" />
        <p className="text-[10px] font-mono tracking-[0.2em] text-neutral-600 uppercase">Loading icons</p>
      </div>
    );
  }

  if (icons.length === 0) {
    return (
      <p className="text-center text-xs font-mono text-neutral-600 py-8 leading-relaxed">
        No icons found in /Assets/icons yet.
        <br />
        Add some image files there to enable picking.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-5 sm:grid-cols-6 gap-3 max-h-64 overflow-y-auto pr-1">
      {icons.map((icon) => (
        <button
          key={icon}
          type="button"
          onClick={() => onChange(icon)}
          className={`aspect-square rounded-lg overflow-hidden border-2 transition-all duration-200 cursor-pointer ${
            value === icon
              ? "border-orange-500 shadow-[0_0_16px_2px_rgba(249,115,22,0.35)]"
              : "border-neutral-800 hover:border-neutral-600 hover:scale-[1.03]"
          }`}
        >
          <img src={icon} alt="" className="w-full h-full object-cover bg-neutral-900" />
        </button>
      ))}
    </div>
  );
}
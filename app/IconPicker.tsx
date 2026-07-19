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
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  if (icons.length === 0) {
    return (
      <p className="text-xs font-mono text-neutral-500 text-center py-6">
        No icons found in /Assets/icons yet. Add some image files there to enable picking.
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
          className={`aspect-square rounded-lg overflow-hidden border-2 transition ${
            value === icon
              ? "border-orange-500 ring-2 ring-orange-500/40"
              : "border-neutral-800 hover:border-neutral-600"
          }`}
        >
          <img src={icon} alt="" className="w-full h-full object-cover bg-neutral-900" />
        </button>
      ))}
    </div>
  );
}
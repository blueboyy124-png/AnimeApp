"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "../ThemeContext";

const LAYOUT_STORAGE_KEY = "streamanime_watch_layout";
type WatchLayout = "default" | "theater";

// Small standalone toggle, matching the switch style used elsewhere
// (watch page settings, kids-profile toggle) for visual consistency.
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
        checked ? "bg-orange-500" : "bg-neutral-700"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b border-neutral-900 last:border-b-0">
      <div>
        <p className="text-sm font-semibold text-neutral-100">{title}</p>
        <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
      </div>
      {control}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const [watchLayout, setWatchLayout] = useState<WatchLayout>("default");

  useEffect(() => {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY) as WatchLayout | null;
    if (stored === "theater" || stored === "default") setWatchLayout(stored);
  }, []);

  const handleLayoutChange = (layout: WatchLayout) => {
    setWatchLayout(layout);
    localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased pb-20 px-4 sm:px-6 md:px-12 pt-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/" className="text-2xl font-black tracking-tighter text-orange-500 hover:opacity-90 transition">
            STREAMANIME
          </Link>
          <h1 className="text-sm md:text-lg font-bold uppercase tracking-widest text-neutral-200 mt-4">
            Settings
          </h1>
        </div>
        <Link
          href="/"
          className="text-xs font-mono uppercase tracking-widest text-neutral-500 hover:text-neutral-200 border border-neutral-800 hover:border-neutral-600 rounded px-4 py-2 transition cursor-pointer"
        >
          &larr; Home
        </Link>
      </div>

      <div className="max-w-2xl space-y-10">
        <section>
          <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-500 mb-3">Appearance</h2>
          <div className="bg-neutral-900/30 border border-neutral-900 rounded-xl px-5">
            <SettingRow
              title="Dark Mode"
              description="Dark is the default look across the app."
              control={<ToggleSwitch checked={theme === "dark"} onChange={toggleTheme} />}
            />
          </div>
        </section>

        <section>
          <h2 className="text-xs font-mono uppercase tracking-widest text-neutral-500 mb-3">Watch Page Layout</h2>
          <div className="bg-neutral-900/30 border border-neutral-900 rounded-xl p-5 space-y-3">
            <p className="text-xs text-neutral-500 mb-2">
              Choose how the player and episode list are arranged when not fullscreened.
            </p>

            <button
              onClick={() => handleLayoutChange("default")}
              className={`w-full text-left p-4 rounded-lg border transition cursor-pointer ${
                watchLayout === "default"
                  ? "border-orange-500 bg-orange-500/5"
                  : "border-neutral-800 hover:border-neutral-700"
              }`}
            >
              <p className="text-sm font-semibold text-neutral-100">Regular (current)</p>
              <p className="text-xs text-neutral-500 mt-1">
                Full-width player, episode list and details below.
              </p>
            </button>

            <button
              onClick={() => handleLayoutChange("theater")}
              className={`w-full text-left p-4 rounded-lg border transition cursor-pointer ${
                watchLayout === "theater"
                  ? "border-orange-500 bg-orange-500/5"
                  : "border-neutral-800 hover:border-neutral-700"
              }`}
            >
              <p className="text-sm font-semibold text-neutral-100">Theater</p>
              <p className="text-xs text-neutral-500 mt-1">
                Smaller player with the episode list docked to the side; details still shown below as usual.
              </p>
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
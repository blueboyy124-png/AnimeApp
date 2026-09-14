"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SiteBannerConfig, SiteBannerTheme } from "./home/types";

// Bumped whenever the localStorage shape changes, not when a banner's
// content changes — the banner's own `id` is what tracks "which message
// has this person already dismissed".
const DISMISS_STORAGE_KEY = "sa_banner_dismissed_v1";

// CSS var read by TopBar (to push the fixed header down) and by any
// section that needs to clear the header stack (HeroSlider's pt-16,
// the homepage's post-hero container, etc.) — see cardHelpers/HeroSlider
// for consumers. Always kept in sync with the banner's real rendered
// height, and reset to 0px whenever the banner isn't showing.
const BANNER_HEIGHT_VAR = "--sa-banner-h";

const THEME_STYLES: Record<SiteBannerTheme, { bg: string; fg: string; border: string; linkFg: string }> = {
  info: { bg: "bg-blue-600", fg: "text-white", border: "border-blue-500/40", linkFg: "text-blue-50" },
  success: { bg: "bg-green-600", fg: "text-white", border: "border-green-500/40", linkFg: "text-green-50" },
  warning: { bg: "bg-amber-500", fg: "text-black", border: "border-amber-400/40", linkFg: "text-black" },
  danger: { bg: "bg-red-600", fg: "text-white", border: "border-red-500/40", linkFg: "text-red-50" },
  promo: { bg: "bg-orange-500", fg: "text-black", border: "border-orange-400/40", linkFg: "text-black" },
};

function isWithinWindow(banner: SiteBannerConfig): boolean {
  const now = Date.now();
  if (banner.startsAt && now < new Date(banner.startsAt).getTime()) return false;
  if (banner.endsAt && now > new Date(banner.endsAt).getTime()) return false;
  return true;
}

function setBannerHeightVar(px: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(BANNER_HEIGHT_VAR, `${px}px`);
}

export function SiteBanner() {
  const [banner, setBanner] = useState<SiteBannerConfig | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Load whatever was dismissed last (per-browser, not per-account — a
  // logged-out visitor and a logged-in profile on the same device share
  // this, which is the right call for a site-wide notice).
  useEffect(() => {
    try {
      setDismissedId(localStorage.getItem(DISMISS_STORAGE_KEY));
    } catch {
      // localStorage unavailable (privacy mode etc.) - just never "remember" a dismissal
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/site-banner", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && data.success) {
          setBanner(data.banner || null);
        }
      } catch {
        // A failed fetch just means no banner this load - never break the page over it.
      }
    };

    load();
    // Polls so an admin edit shows up for people already on the page
    // without them needing to refresh.
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const active = !!banner && banner.enabled && isWithinWindow(banner) && banner.message.trim().length > 0;
  const dismissed = !!banner && dismissedId === banner.id;
  const visible = active && !dismissed;

  // Keep the shared CSS var (read by TopBar + HeroSlider + page.tsx) in
  // sync with the banner's real height, including on resize/font-load —
  // a hardcoded height estimate would drift as soon as the message wraps
  // to a second line on a narrow screen.
  useEffect(() => {
    if (!visible) {
      setBannerHeightVar(0);
      return;
    }
    const el = barRef.current;
    if (!el) return;
    const update = () => setBannerHeightVar(el.getBoundingClientRect().height);
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [visible, banner?.message, banner?.linkLabel]);

  if (!visible || !banner) return null;

  const theme = THEME_STYLES[banner.theme] || THEME_STYLES.info;

  const handleDismiss = () => {
    setDismissedId(banner.id);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, banner.id);
    } catch {
      // best-effort only
    }
  };

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="Site announcement"
      className={`fixed top-0 inset-x-0 z-[70] ${theme.bg} ${theme.fg} border-b ${theme.border}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-2 flex items-center justify-center gap-3 flex-wrap text-center">
        <p className="text-xs sm:text-sm font-semibold leading-snug">
          {banner.message}
          {banner.linkHref && banner.linkLabel && (
            <Link href={banner.linkHref} className={`ml-2 underline underline-offset-2 font-bold ${theme.linkFg} hover:opacity-80 transition`}>
              {banner.linkLabel}
            </Link>
          )}
        </p>
        {banner.dismissible && (
          <button
            onClick={handleDismiss}
            aria-label="Dismiss announcement"
            className="absolute right-3 sm:right-6 md:right-12 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full hover:bg-black/10 transition text-sm leading-none cursor-pointer"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
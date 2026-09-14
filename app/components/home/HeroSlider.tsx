"use client";

import Link from "next/link";
import { useEffect, useRef, type TouchEvent as ReactTouchEvent } from "react";
import { AnimeCard } from "./types";
import { getDisplayTitle, getDetailsHref, cleanDescription } from "./cardHelpers";

interface HeroSliderProps {
  loading: boolean;
  items: AnimeCard[];
  activeIndex: number;
  onDotClick: (index: number) => void;
  // Lets the parent's autoplay timer pause while the person is actually
  // looking at the banner, instead of yanking the slide out from under
  // them mid-read.
  onPauseChange?: (paused: boolean) => void;
}

// Resolves the same backdrop/banner/cover fallback chain used for render,
// factored out so it can also be used to prefetch a slide's image ahead of
// time (see the preload effect below).
function getHeroImageSrc(show: AnimeCard): string | undefined {
  if (show.backdrop_path) return `https://image.tmdb.org/t/p/original${show.backdrop_path}`;
  if (show.bannerImage) return show.bannerImage;
  if (show.coverImage && typeof show.coverImage === "object") {
    return (show.coverImage as any).extraLarge || (show.coverImage as any).large;
  }
  if (typeof show.coverImage === "string") return show.coverImage;
  return undefined;
}

// The homepage spotlight banner: an auto-rotating (and dot-navigable)
// carousel over the top few trending titles. Shows a shimmering skeleton
// while the kids-safety rating check on `trending` is still resolving, so
// nothing above a kids profile's rating cutoff can flash on screen.
export function HeroSlider({ loading, items, activeIndex, onDotClick, onPauseChange }: HeroSliderProps) {
  // The trending list can still be re-filtering (kids cert checks resolving
  // async) after the autoplay timer has already advanced activeIndex —
  // without clamping, a shrinking `items` array could leave activeIndex
  // pointing past the end and render a blank slide for a beat. That
  // "flash of nothing" mid-rotation was a big part of what read as glitchy.
  const safeIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0;

  // Prefetch the image for the next slide (and the one after) slightly
  // ahead of when it's needed, so the carousel never transitions onto an
  // image that's still starting its network request — that stall-then-pop
  // was the other main source of the "glitchy" feeling.
  const prefetchedRef = useRef<Set<string>>(new Set());

  // Swipe-to-navigate for touch devices — hover-to-pause (below) has no
  // touch equivalent, so without this the carousel could autoplay out
  // from under a finger mid-swipe, and there was otherwise no way to
  // manually advance the slide on a phone at all. Declared above the
  // early returns below since hooks can't follow a conditional return.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || items.length === 0) return;
    const upcoming = [items[(safeIndex + 1) % items.length], items[(safeIndex + 2) % items.length]];
    for (const show of upcoming) {
      const src = show && getHeroImageSrc(show);
      if (!src || prefetchedRef.current.has(src)) continue;
      prefetchedRef.current.add(src);
      const img = new Image();
      img.src = src;
    }
  }, [safeIndex, items]);

  if (loading) {
    return (
      <section className="relative w-full h-[68vh] sm:h-[82vh] md:h-[94vh] bg-[#090a0f] overflow-hidden pt-[calc(4rem+var(--sa-banner-h,0px))]">
        <div className="absolute inset-0 bg-neutral-900 shimmer" />
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-8 md:p-16 space-y-3 max-w-3xl">
          <div className="h-3 w-24 rounded bg-neutral-800 shimmer" />
          <div className="h-10 md:h-14 w-2/3 rounded bg-neutral-800 shimmer" />
          <div className="h-3 w-1/2 rounded bg-neutral-800 shimmer" />
        </div>
      </section>
    );
  }

  if (items.length === 0) return null;

  const handleTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    onPauseChange?.(true);
  };

  const handleTouchEnd = (e: ReactTouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    onPauseChange?.(false);
    if (!start || items.length <= 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Ignore short taps/jitters and mostly-vertical gestures (those are
    // page scrolls, not slide swipes).
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    const direction = dx < 0 ? 1 : -1;
    onDotClick((safeIndex + direction + items.length) % items.length);
  };

  return (
    <section
      className="relative w-full h-[68vh] sm:h-[82vh] md:h-[94vh] bg-[#090a0f] overflow-hidden pt-[calc(4rem+var(--sa-banner-h,0px))]"
      onMouseEnter={() => onPauseChange?.(true)}
      onMouseLeave={() => onPauseChange?.(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      aria-roledescription="carousel"
      aria-label="Spotlight titles"
    >
      <div
        className="w-full h-full flex transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{
          transform: `translate3d(-${safeIndex * 100}%, 0, 0)`,
          willChange: "transform",
        }}
      >
        {items.map((show, index) => {
          // Only the active slide and its immediate neighbors need to be
          // ready to paint instantly — everything else can genuinely wait,
          // so this isn't "eager-load everything" (which would just move
          // the network cost earlier for slides that may never be seen).
          const isNear =
            Math.abs(index - safeIndex) <= 1 ||
            (items.length > 2 && index === (safeIndex + items.length - 1) % items.length);
          return (
            <div key={`${show.media_type || "x"}-${show.id}`} className="relative w-full h-full flex-shrink-0 overflow-hidden">
              <img
                src={
                  getHeroImageSrc(show) ||
                  "https://images.unsplash.com/photo-1574375927938-d5a98e8edd86?q=80&w=1600&auto=format&fit=crop"
                }
                alt="Spotlight Artwork"
                // Shifted down from the original center_30% — keeps more of
                // the image's own "floor" in frame so the gradient below has
                // less busy detail to fight against and the artwork reads as
                // a quiet backdrop rather than the main event.
                className="absolute inset-0 w-full h-full object-cover object-[center_42%]"
                loading={isNear ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
                fetchPriority={index === safeIndex ? "high" : isNear ? "low" : undefined}
              />
              {/* Full-height cinematic fade: the artwork stays legible while
                  the bottom edge dissolves continuously into the page canvas. */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(9,10,15,0) 0%, rgba(9,10,15,0) 75%, rgba(9,10,15,0.22) 85%, rgba(9,10,15,0.55) 92%, rgba(9,10,15,0.86) 97%, rgb(9,10,15) 100%)",
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/10 to-transparent" />

              <div className="absolute inset-x-0 bottom-52 sm:bottom-56 md:bottom-64 p-4 sm:p-8 md:p-16 space-y-3 md:space-y-4 z-10 max-w-3xl">
                <span className="inline-flex items-center gap-1.5 text-[9px] md:text-[10px] font-bold tracking-widest text-orange-500 uppercase">
                  <span className="w-3 h-[2px] bg-orange-500 rounded-full" />
                  #{index + 1} Spotlight
                </span>

                <h2 className="flex items-stretch gap-3 md:gap-4">
                  <span className="w-1.5 md:w-2 flex-shrink-0 rounded-full bg-orange-500" />
                  <span className="text-2xl sm:text-4xl md:text-6xl font-black tracking-tight text-[#f2f0ec] leading-[1.05] drop-shadow-lg line-clamp-2">
                    {getDisplayTitle(show)}
                  </span>
                </h2>

                <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 text-[10px] md:text-xs font-semibold text-neutral-300">
                  {(show as any).averageScore != null && (
                    <>
                      <span className="flex items-center gap-1 text-orange-400">
                        <span>★</span>
                        {((show as any).averageScore / 10).toFixed(1)}
                      </span>
                      <span className="text-neutral-600 font-normal">|</span>
                    </>
                  )}
                  {((show as any).seasonYear || (show as any).year) && (
                    <>
                      <span>{(show as any).seasonYear || (show as any).year}</span>
                      <span className="text-neutral-600 font-normal">|</span>
                    </>
                  )}
                  {(show.media_type || show.format || show.type) && (
                    <>
                      <span className="px-1.5 py-0.5 border border-white/20 rounded-md text-[9px] md:text-[10px] uppercase tracking-wide text-neutral-300">
                        {show.media_type === "movie" ? "Movie" : show.media_type === "tv" ? "TV Show" : (show.format || show.type)}
                      </span>
                      {Array.isArray(show.genres) && show.genres.length > 0 && (
                        <span className="text-neutral-600 font-normal">|</span>
                      )}
                    </>
                  )}
                  {Array.isArray(show.genres) && show.genres.length > 0 && (
                    <span className="text-neutral-400 line-clamp-1">{show.genres.slice(0, 3).join(" • ")}</span>
                  )}
                </div>

                <p className="text-[11px] md:text-sm text-neutral-300 max-w-xl line-clamp-2 sm:line-clamp-3 leading-relaxed drop-shadow">
                  {cleanDescription(show.description || show.overview)}
                </p>

                <div className="flex items-center space-x-3 pt-1 md:pt-3">
                  <Link
                    href={getDetailsHref(show)}
                    className="bg-[#f2f0ec] hover:bg-white text-[#090a0f] font-bold text-xs md:text-sm px-4 py-2 md:px-6 md:py-3 rounded-lg transition-all duration-300 hover:scale-[1.03] flex items-center space-x-2 active:scale-95 shadow-lg shadow-black/20"
                  >
                    <img src="/Assets/play-button.png" alt="" className="w-3.5 h-3.5 md:w-5 md:h-5 object-contain" />
                    <span>Play</span>
                  </Link>
                  <Link
                    href={getDetailsHref(show)}
                    className="bg-[#12151b]/80 hover:bg-[#181c23] border border-white/15 hover:border-white/30 text-[#f2f0ec] font-bold text-xs md:text-sm px-4 py-2 md:px-6 md:py-3 rounded-lg transition-all duration-300 hover:scale-[1.03] active:scale-95"
                  >
                    More Info
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Moved up off the very bottom edge and over to the right, out of the
          title block's way, and above the mobile tab bar. */}
      <div className="absolute bottom-9 sm:bottom-11 md:bottom-14 right-4 sm:right-8 md:right-16 z-20 flex items-center gap-1.5">
        {items.map((_, dotIdx) => (
          <button
            key={dotIdx}
            onClick={() => onDotClick(dotIdx)}
            aria-label={`Go to spotlight slide ${dotIdx + 1}`}
            className={`h-1 rounded-full transition-all duration-300 hover:opacity-100 ${
              dotIdx === safeIndex ? "w-6 bg-orange-500" : "w-2 bg-neutral-500/60 hover:bg-neutral-300/80"
            }`}
          />
        ))}
      </div>
    </section>
  );
}

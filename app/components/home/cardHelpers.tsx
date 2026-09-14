"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimeCard, CardInteractionHandlers } from "./types";

// Explicit per-breakpoint column counts, capped at 5 — never more than 5
// shows wide at any viewport, matching the 5-per-row cap used on the
// horizontal shelves (see ROW_CARD_WIDTH_CLASS below). This still avoids
// the old iPad bug (cards overflowing their cell and overlapping their
// neighbor) because the fix was never really "auto-fill" itself — it was
// pairing the grid with a fluid, `w-full` card (see the "grid" variant
// below) instead of a fixed-pixel one. As long as the card sizes itself
// off its own cell, a fixed column count per breakpoint is just as safe
// as auto-fill, and it's what lets us guarantee the 5-wide cap.
export const SHOWCASE_GRID_CLASS =
  "grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-3 gap-y-8 md:gap-x-5 md:gap-y-10";

// Same 5-per-row cap, sized as a percentage of the shelf width instead of
// a column count — used by the horizontally-scrolling rows (Continue
// Watching, "Because you watched", adaptive rows) via ScrollShelf below.
// Percentages (not fixed px like the old w-60/w-72) mean the shelf always
// shows a consistent, intentional number of cards per breakpoint instead
// of however many happen to fit a fixed width: ~2.3 on phones, ~3.2 on
// small tablets, ~4.2 on tablets/small laptops, and exactly 5 from
// desktop up — never more.
export const ROW_CARD_WIDTH_CLASS =
  "w-[42%] xs:w-[33%] sm:w-[31%] md:w-[23%] lg:w-[19.2%] flex-shrink-0";

export function getDisplayTitle(anime: AnimeCard) {
  if (typeof anime.title === "string") return anime.title;
  if (anime.title && typeof anime.title === "object") {
    return anime.title.english || anime.title.romaji || anime.title.userPreferred || "Untitled Show";
  }
  return anime.name || anime.title || "Untitled Show";
}

export function getDisplayCover(anime: AnimeCard) {
  const isPlaceholder = (p: string) =>
    p.toLowerCase() === "n/a" ||
    p === "?" ||
    p.includes("placeholder") ||
    p.includes("placehold.co") ||
    p.includes("nopicture") ||
    p.includes("no-cover") ||
    p.includes("CR0,0,380,562"); // Intercepts the default IMDb question mark cover returned in your JSON

  // 1. Landscape sources first — cards are rectangular now, so a proper
  // wide image (AniList's bannerImage, TMDB's backdrop_path) looks far
  // better cropped into a 16:9 box than a portrait poster would.
  if (typeof anime.bannerImage === "string" && anime.bannerImage.trim().length > 0 && !isPlaceholder(anime.bannerImage.trim())) {
    const clean = anime.bannerImage.trim();
    return clean.startsWith("/") ? `https://image.tmdb.org/t/p/w780${clean}` : clean;
  }
  if (typeof anime.backdrop_path === "string" && anime.backdrop_path.trim().length > 0 && !isPlaceholder(anime.backdrop_path.trim())) {
    return `https://image.tmdb.org/t/p/w780${anime.backdrop_path.trim()}`;
  }

  // 2. Nested AniList structural definitions (portrait) — used only when
  // no landscape image exists above.
  if (anime.coverImage && typeof anime.coverImage === "object") {
    const imgObj = anime.coverImage as any;
    if (imgObj.extraLarge) return imgObj.extraLarge;
    if (imgObj.large) return imgObj.large;
    if (imgObj.medium) return imgObj.medium;
  }

  // 3. Scan remaining fallback properties sequentially (portrait sources)
  const potentialPaths = [
    anime.coverImage,
    anime.image,
    anime.poster,
    anime.cover,
    anime.poster_path,
  ];

  for (const path of potentialPaths) {
    if (typeof path === "string" && path.trim().length > 0) {
      const cleanPath = path.trim();
      if (isPlaceholder(cleanPath)) continue;
      if (cleanPath.startsWith("/")) {
        return `https://image.tmdb.org/t/p/w500${cleanPath}`;
      }
      return cleanPath;
    }
  }

  // 4. High-quality visual fallback background (No broken layouts or question marks)
  return "https://images.unsplash.com/photo-1574375927938-d5a98e8edd86?q=80&w=500&auto=format&fit=crop";
}

export function getDetailsHref(anime: AnimeCard) {
  // Prefer the explicit media_type field — it's what isTmdbResult() below
  // already relies on to correctly split the TV/movie carousels, so it's
  // the most reliable signal we have. Only fall back to guessing from
  // other TMDB-only fields when media_type itself is missing.
  if (anime.media_type === "tv" || anime.media_type === "series") {
    return `/anime/tmdb-tv-${anime.id}`;
  }
  if (anime.media_type === "movie") {
    return `/anime/tmdb-movie-${anime.id}`;
  }

  const isTmdbSource =
    anime.poster_path !== undefined ||
    anime.backdrop_path !== undefined ||
    anime.genre_ids !== undefined ||
    anime.original_language !== undefined;

  if (isTmdbSource) {
    const mediaType = String(anime.type || anime.format || "").toLowerCase();

    // Checks if the scraper flagged this index item as a TV series collection
    if (mediaType === "tv" || mediaType === "series") {
      return `/anime/tmdb-tv-${anime.id}`;
    }

    // Default routing fallback behavior for feature films
    return `/anime/tmdb-movie-${anime.id}`;
  }

  // Regular AniList anime — plain numeric AniList id, no prefix.
  return `/anime/${anime.id}`;
}

export function isTmdbResult(item: AnimeCard) {
  return item.media_type === "movie" || item.media_type === "tv";
}

// TMDB's global genre id for Animation. Used to detect TMDB search results
// (movies/tv) that are actually anime, so the detail page can attempt to
// resolve them onto the native AniList/anime pipeline instead of the
// generic TMDB one (see buildWatchHref in app/anime/[id]/page.tsx).
const TMDB_ANIMATION_GENRE_ID = 16;

// Checks both shapes a TMDB payload can carry genre info in: the compact
// `genre_ids: number[]` returned by /search and /discover endpoints, and
// the expanded `genres: { id, name }[]` (or plain string[]) returned by the
// /movie/{id} and /tv/{id} detail endpoints. Any TMDB result carrying
// either "16"/"Animation" is treated as anime for routing purposes.
export function isAnimationTmdbResult(item: AnimeCard): boolean {
  const genreIds = (item as any).genre_ids;
  if (Array.isArray(genreIds) && genreIds.includes(TMDB_ANIMATION_GENRE_ID)) {
    return true;
  }

  const genres = (item as any).genres;
  if (Array.isArray(genres)) {
    return genres.some((g: any) => {
      const name = typeof g === "string" ? g : g?.name;
      return typeof name === "string" && name.toLowerCase() === "animation";
    });
  }

  return false;
}

// Whether a title has an actual, displayable rating — same test the card's
// own rating badge already uses (see getRatingBadge/rating below), factored
// out so other views (currently: search) can filter to only rated titles
// without duplicating the check or drifting out of sync with what the
// badge itself considers "rated". `0` is treated as unrated rather than a
// real score of zero, since that's how an absent TMDB vote_average comes
// through (see extractTmdbResults in page.tsx).
export function hasRating(anime: AnimeCard): boolean {
  return typeof anime.averageScore === "number" && anime.averageScore > 0;
}

// Real, muted source-brand colors instead of one loud orange star — used by
// the hover-only rating badge on each card. Solid fills, no gradients.
function getRatingBadge(anime: AnimeCard) {
  if (isTmdbResult(anime)) {
    return { label: "IMDb", bg: "#f5c518", fg: "#000000" };
  }
  return { label: "AniList", bg: "#3db4f2", fg: "#0b1622" };
}

export function formatSecondsToLabel(seconds: number) {
  if (isNaN(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.round(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function cleanDescription(htmlStr?: string) {
  if (!htmlStr) return "Stream instantly in high definition.";
  return htmlStr.replace(/<\/?[^>]+(>|$)/g, "").substring(0, 140) + "...";
}

interface AnimeCardTileProps extends CardInteractionHandlers {
  anime: AnimeCard;
  variant?: "row" | "grid";
}

// `variant` controls sizing strategy:
// - "row"  → fixed-width cards inside a horizontally-scrolling flex shelf
//            (each card needs an explicit width since flex children in an
//            overflow-x row don't have a track to size against).
// - "grid" → fluid cards that fill their CSS Grid cell. The grid container
//            itself (see SHOWCASE_GRID_CLASS above) determines each cell's
//            width, so the card must be w-full — a fixed width here is what
//            caused cards to overflow their cell and overlap their
//            neighbors on mid-width viewports like iPad.
function AnimeCardTileComponent({ anime, variant = "row", onHoverStart, onHoverEnd, onCardClick }: AnimeCardTileProps) {
  const rating = typeof anime.averageScore === "number" ? (anime.averageScore / 10).toFixed(1) : null;
  const ratingBadge = rating ? getRatingBadge(anime) : null;
  const impressionKey = `${anime.media_type || "anime"}-${anime.id}`;

  return (
    <Link
      href={getDetailsHref(anime)}
      onMouseEnter={() => onHoverStart?.(impressionKey)}
      onMouseLeave={() => onHoverEnd?.(impressionKey)}
      onClick={() => onCardClick?.(impressionKey)}
      className={`group flex flex-col space-y-2 outline-none ${
        variant === "grid" ? "w-full" : ROW_CARD_WIDTH_CLASS
      }`}
    >
      <div className="relative origin-center transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105 2xl:group-hover:scale-[1.08] group-hover:z-30 group-focus-within:scale-105 group-focus-within:z-30">
        <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-[#12151b] shadow-md ring-1 ring-white/5 border border-white/10 transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-black/70 group-hover:border-white/20 group-hover:ring-orange-500/15">
          <img
            src={getDisplayCover(anime)}
            alt={getDisplayTitle(anime)}
            className="w-full h-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-110"
            loading="lazy"
            decoding="async"
            draggable={false}
          />

          {/* Rating only reveals on hover now, styled as a source-branded
              badge + score pair rather than a permanently-visible orange
              star — quieter by default, informative on demand. */}
          {ratingBadge && (
            <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-300">
              <span
                className="font-black text-[8px] px-1.5 py-0.5 rounded-sm leading-none tracking-wide"
                style={{ backgroundColor: ratingBadge.bg, color: ratingBadge.fg }}
              >
                {ratingBadge.label}
              </span>
              <span className="text-white text-[10px] font-bold bg-black/75 backdrop-blur-sm px-1.5 py-0.5 rounded-sm leading-none">
                {rating}
              </span>
            </div>
          )}

          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors duration-300" />

          <div className="absolute inset-0 flex items-center justify-center gap-2.5 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100 transition-all duration-300">
            <span className="bg-[#f2f0ec] text-black rounded-full w-9 h-9 flex items-center justify-center hover:bg-white hover:scale-110 transition-all duration-300 shadow-lg">
              <img src="/Assets/play-button.png" alt="Play" className="w-3.5 h-3.5 object-contain" />
            </span>
            <span className="border border-white/45 text-[#f2f0ec] rounded-full w-9 h-9 flex items-center justify-center text-sm font-bold hover:border-white hover:scale-110 transition-all duration-300 bg-black/40">
              i
            </span>
          </div>
        </div>
      </div>

      <div className="px-0.5 space-y-0.5">
        <h4 className="font-semibold text-xs md:text-sm leading-tight line-clamp-2 text-[#c8cbd1] group-hover:text-orange-400 transition-all duration-300">
          {getDisplayTitle(anime)}
        </h4>
        <div className="text-[9px] md:text-[10px] font-mono text-[#737b87] tracking-tight font-medium uppercase">
          {anime.media_type === "movie" ? "Movie" : anime.media_type === "tv" ? "TV Show" : "Anime"}
        </div>
      </div>
    </Link>
  );
}

// Memoized: card grids can hold dozens of tiles, and without this every
// card in the list re-rendered whenever anything else on the page changed
// (typing in search, hovering an unrelated card, etc). Props are simple
// values/stable callbacks so a shallow prop comparison is all that's needed.
export const AnimeCardTile = memo(AnimeCardTileComponent);

interface CardGridProps extends CardInteractionHandlers {
  list: AnimeCard[];
  variant?: "row" | "grid";
}

// Shared card markup so search-category sections, "because you watched"
// shelves, adaptive contextual rows, and the normal feed grid all render
// identical cards without duplicating the JSX.
function CardGridComponent({ list, variant = "row", onHoverStart, onHoverEnd, onCardClick }: CardGridProps) {
  // Defensive dedupe: identical media_type+id pairs are valid repeats coming
  // from different data sources (TMDB recommendations overlapping the browse
  // feed), but React requires unique keys. Dropping later duplicates keeps a
  // given title from rendering twice in the same grid/row.
  const seen = new Set<string>();
  const deduped = list.filter((anime) => {
    const key = `${anime.media_type || "anime"}-${anime.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <>
      {deduped.map((anime) => {
        const impressionKey = `${anime.media_type || "anime"}-${anime.id}`;
        return (
          <AnimeCardTile
            key={impressionKey}
            anime={anime}
            variant={variant}
            onHoverStart={onHoverStart}
            onHoverEnd={onHoverEnd}
            onCardClick={onCardClick}
          />
        );
      })}
    </>
  );
}

export const CardGrid = memo(CardGridComponent);

// Shared horizontal-scroll shelf chrome: hover-revealed prev/next arrows
// (desktop only — touch devices already scroll natively) plus matching
// edge fades, both of which only appear once there's actually more
// content in that direction so they never show as dead controls. Used by
// WatchHistory and RecommendationRow so every shelf in the app behaves
// identically instead of each screen reimplementing its own scroller.
export function ScrollShelf({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateEdges) : null;
    ro?.observe(el);
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      ro?.disconnect();
      window.removeEventListener("resize", updateEdges);
    };
    // Re-check whenever the shelf's contents change (e.g. a lazily-loaded
    // row swaps in real items), since that can change scrollWidth without
    // firing a scroll or resize event on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateEdges, children]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // 90% of the visible width so a click pages in a near-full new set of
    // cards without ever slicing one exactly in half at the edge.
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: "smooth" });
  };

  return (
    <div className="relative group/shelf">
      {canScrollLeft && (
        <>
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-10 md:w-20 z-20 bg-gradient-to-r from-neutral-950 to-transparent opacity-0 group-hover/shelf:opacity-100 transition-opacity duration-300" />
          <button
            type="button"
            onClick={() => scrollByPage(-1)}
            aria-label="Scroll left"
            className="hidden md:flex absolute left-0 top-0 bottom-0 z-30 w-14 items-center justify-center opacity-0 group-hover/shelf:opacity-100 transition-opacity duration-300 cursor-pointer"
          >
            <span className="w-9 h-9 rounded-full bg-[#0d0f14]/92 border border-white/15 flex items-center justify-center text-lg text-[#f2f0ec] shadow-lg hover:bg-[#181c23] hover:border-orange-500/50 hover:scale-110 transition-all duration-300">
              ‹
            </span>
          </button>
        </>
      )}

      {canScrollRight && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 md:w-20 z-20 bg-gradient-to-l from-neutral-950 to-transparent opacity-0 group-hover/shelf:opacity-100 transition-opacity duration-300" />
          <button
            type="button"
            onClick={() => scrollByPage(1)}
            aria-label="Scroll right"
            className="hidden md:flex absolute right-0 top-0 bottom-0 z-30 w-14 items-center justify-center opacity-0 group-hover/shelf:opacity-100 transition-opacity duration-300 cursor-pointer"
          >
            <span className="w-9 h-9 rounded-full bg-[#0d0f14]/92 border border-white/15 flex items-center justify-center text-lg text-[#f2f0ec] shadow-lg hover:bg-[#181c23] hover:border-orange-500/50 hover:scale-110 transition-all duration-300">
              ›
            </span>
          </button>
        </>
      )}

      {/* Extra vertical padding + canceling negative margin so a card's
          hover lift/scale has room to render without getting clipped —
          overflow-x-auto forces overflow-y to `auto` too per the CSS
          overflow spec, so without this headroom the scaled card's
          top/bottom edges get cut off by this container. */}
      <div
        ref={scrollerRef}
        role="list"
        aria-label={ariaLabel}
        className="flex gap-4 overflow-x-auto scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-8 -my-8 scroll-smooth"
      >
        {children}
      </div>
    </div>
  );
}

// The shared skeleton shown while the first page of a feed/search is
// loading — identical markup regardless of which view triggered it.
export function ShowcaseSkeleton() {
  return (
    <section className="space-y-4 md:space-y-6">
      <div className={SHOWCASE_GRID_CLASS}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-col space-y-2">
            <div className="aspect-video w-full rounded-lg bg-neutral-900 border border-neutral-900 shimmer overflow-hidden" />
            <div className="h-2.5 w-4/5 rounded bg-neutral-900 shimmer overflow-hidden" />
            <div className="h-2 w-1/3 rounded bg-neutral-900/70 shimmer overflow-hidden" />
          </div>
        ))}
      </div>
    </section>
  );
}

// The "no matching titles" empty state, reused by both the search view and
// the standard browse grid. `inGrid` adds col-span-full for when this sits
// directly inside a CSS grid container (the standard browse grid) rather
// than standalone below the search category sections.
export function NoResultsNotice({ inGrid = false }: { inGrid?: boolean }) {
  return (
    <div className={`bg-neutral-900/30 border border-neutral-900 rounded-lg ${inGrid ? "col-span-full " : ""}p-12 text-center max-w-sm mx-auto space-y-1`}>
      <p className="text-neutral-400 font-semibold text-xs">
        No matching titles discovered
      </p>
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        Adjust spellings or explore alternative categories.
      </p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import IconPicker from "./IconPicker";
import {
  MAX_PROFILES,
  SupabaseAccount,
  SupabaseProfile,
  createProfile,
  updateProfile,
  deleteProfile,
} from "./utils/supabase";
import { AnimeCard } from "./components/home/types";
import { getDisplayCover, getDisplayTitle } from "./components/home/cardHelpers";
import { filterForKids, useKidsSafeList } from "./utils/contentFilter";

// ══════════════════════════════════════════════════════════════
// PROFILE-PAGE SPOTLIGHT BACKDROP
// Real rotating key art behind the profile picker, instead of the static
// illustration. Pulls the exact same weekly trending pool, on the same
// "highly rated" quality bar, as the homepage hero banner (see
// fetchTmdbCategoryPage("trending", ...) in page.tsx) — movies + TV only,
// no anime, for the same reason the homepage hero has none: this is a
// movies/TV site that only surfaces anime once someone has anime watch
// history to personalize from, which the profile-select screen has no
// concept of yet.
// ══════════════════════════════════════════════════════════════
const HERO_TMDB_API_KEY = "e0554f6521da4365d4a36ea7ff17ae51";
const HERO_MIN_VOTE_AVERAGE = 6.5;
const HERO_MIN_VOTE_COUNT = 50;
const HERO_SLIDE_COUNT = 5;
const HERO_ROTATE_MS = 7000;

async function fetchProfileHeroTrending(): Promise<AnimeCard[]> {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/trending/all/week?api_key=${HERO_TMDB_API_KEY}&page=1`
    );
    const data = await res.json();
    const raw = Array.isArray(data?.results) ? data.results : [];
    return raw
      .filter(
        (r: any) =>
          (r.media_type === "movie" || r.media_type === "tv") &&
          (r.vote_average || 0) >= HERO_MIN_VOTE_AVERAGE &&
          (r.vote_count || 0) >= HERO_MIN_VOTE_COUNT
      )
      .map(
        (r: any) =>
          ({
            id: r.id,
            title: r.title || r.name,
            media_type: r.media_type,
            poster_path: r.poster_path,
            backdrop_path: r.backdrop_path,
            overview: r.overview,
            averageScore: r.vote_average * 10,
            seasonYear: (r.release_date || r.first_air_date || "").slice(0, 4) || undefined,
          } as AnimeCard)
      );
  } catch (err) {
    console.error("Error fetching profile-page spotlight backdrop:", err);
    return [];
  }
}

// Spreads two content pools across a fixed number of slots in proportion to
// `kidsShare` (0..1), using the same running-remainder trick you'd use to
// draw an evenly-dashed line (Bresenham-style accumulation) rather than just
// taking the first N% of slots from one pool and the rest from the other.
// That keeps a mixed household's row genuinely interleaved — kids and
// regular titles alternating across the banner — instead of clumped at one
// end of it. E.g. 2 kids profiles + 1 regular profile -> kidsShare = 2/3,
// so ~2 of every 3 slides skew toward the kids-safe pool.
function buildMixedHeroFeed(
  kidsPool: AnimeCard[],
  regularPool: AnimeCard[],
  kidsShare: number,
  slotCount: number
): AnimeCard[] {
  const usedKeys = new Set<string>();
  const keyOf = (a: AnimeCard) => `${a.media_type || "x"}-${a.id}`;

  function takeNext(pool: AnimeCard[], cursor: { i: number }): AnimeCard | null {
    while (cursor.i < pool.length) {
      const candidate = pool[cursor.i++];
      const key = keyOf(candidate);
      if (!usedKeys.has(key)) {
        usedKeys.add(key);
        return candidate;
      }
    }
    return null;
  }

  const kidsCursor = { i: 0 };
  const regularCursor = { i: 0 };
  const slides: AnimeCard[] = [];
  let remainder = 0;

  for (let i = 0; i < slotCount; i++) {
    remainder += kidsShare;
    const wantsKids = remainder >= 1;
    if (wantsKids) remainder -= 1;

    let pick = wantsKids ? takeNext(kidsPool, kidsCursor) : takeNext(regularPool, regularCursor);
    // If the pool this slot wanted has run dry, fall back to whichever pool
    // still has something left rather than leaving the row short.
    if (!pick) {
      pick = wantsKids ? takeNext(regularPool, regularCursor) : takeNext(kidsPool, kidsCursor);
    }
    if (pick) slides.push(pick);
  }

  return slides;
}

interface ProfilePageProps {
  account: SupabaseAccount;
  profiles: SupabaseProfile[];
  onProfilesChange: (profiles: SupabaseProfile[]) => void;
  onSelectProfile: (profile: SupabaseProfile) => void;
  onLogout: () => void;
}

type ModalState = { mode: "create" } | { mode: "edit"; profile: SupabaseProfile } | null;

export default function ProfilePage({ account, profiles, onProfilesChange, onSelectProfile, onLogout }: ProfilePageProps) {
  const [modal, setModal] = useState<ModalState>(null);
  const [manageMode, setManageMode] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  // ── Spotlight backdrop data ─────────────────────────────────────────
  const [heroTrending, setHeroTrending] = useState<AnimeCard[]>([]);
  const [heroTrendingLoading, setHeroTrendingLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchProfileHeroTrending().then((results) => {
      if (!cancelled) {
        setHeroTrending(results);
        setHeroTrendingLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Same two-pass kids filtering the homepage hero uses: filterForKids()
  // is the fast, free, synchronous pass; useKidsSafeList() follows up with
  // real TMDB certification checks so nothing above a kids cutoff can ever
  // flash on screen, even for a beat.
  const kidsSourceList = useMemo(() => filterForKids(heroTrending, true), [heroTrending]);
  const { list: kidsSafeTrending, loading: kidsCertLoading } = useKidsSafeList(kidsSourceList, true);

  // What fraction of this account's profiles are Kids profiles — e.g. 2
  // kids + 1 regular = 2/3, so the backdrop rotation skews ~66% kids-safe
  // titles and ~33% regular ones. No profiles yet (shouldn't happen once
  // an account exists, but just in case) falls back to fully regular.
  const kidsShare = profiles.length > 0 ? profiles.filter((p) => p.is_kids).length / profiles.length : 0;

  const heroItems = useMemo(
    () => buildMixedHeroFeed(kidsSafeTrending, heroTrending, kidsShare, HERO_SLIDE_COUNT),
    [kidsSafeTrending, heroTrending, kidsShare]
  );

  // Only wait on the real-certification pass if there's actually a kids
  // share to filter for — an all-regular household shouldn't sit on a
  // loading state that only matters for kids profiles.
  const heroReady = !heroTrendingLoading && (kidsShare === 0 || !kidsCertLoading);

  // Index is owned here (not inside ProfileHeroBackdrop) — same controlled
  // pattern page.tsx already uses for the homepage HeroSlider — so the
  // title text below can stay in lockstep with whichever slide is showing.
  const [heroIndex, setHeroIndex] = useState(0);
  const heroSlideCount = Math.min(heroItems.length, HERO_SLIDE_COUNT);
  const safeHeroIndex = heroSlideCount > 0 ? Math.min(heroIndex, heroSlideCount - 1) : 0;
  const activeHeroShow = heroReady && heroSlideCount > 0 ? heroItems[safeHeroIndex] : null;

  useEffect(() => {
    if (heroSlideCount <= 1) return;
    const interval = setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroSlideCount);
    }, HERO_ROTATE_MS);
    return () => clearInterval(interval);
  }, [heroSlideCount]);

  const closeModal = () => setModal(null);

  const handleSaved = (updated: SupabaseProfile[]) => {
    onProfilesChange(updated);
    closeModal();
  };

  // Brief glow-then-fade before actually switching, instead of an instant
  // cut — gives the selection a sense of weight instead of feeling abrupt.
  const handleSelect = (profile: SupabaseProfile) => {
    if (selectingId) return; // ignore double-clicks mid-transition
    setSelectingId(profile.id);
    window.setTimeout(() => onSelectProfile(profile), 260);
  };

  return (
    <div className="relative min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased overflow-hidden">
      {/* Full-bleed hero banner — real, rotating key art pulled from the same
          weekly trending pool (and quality bar) the homepage hero uses,
          mixed toward Kids-safe or regular titles depending on how many of
          this account's profiles are Kids profiles. Falls back to the old
          illustrated SVG scene while that data is loading or if the fetch
          ever comes back empty, so there's never a blank box. */}
      <div className="absolute inset-0 z-0 bg-neutral-950 overflow-hidden">
        <ProfileHeroBackdrop items={heroItems} loading={!heroReady} activeIndex={heroIndex} />
      </div>

      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Soft vignette centered on the middle of the screen, where the
            title now lives — independent of the bottom-anchored gradient
            below, so there's real contrast up there regardless of how
            bright the artwork behind it happens to be. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 75% 60% at 50% 40%, rgba(9,9,9,0.6) 0%, rgba(9,9,9,0.24) 55%, transparent 78%)",
          }}
        />

        {/* Legibility fade down to where the profile row sits — pushed a
            bit further up than before so there's real contrast for the
            title text sitting in it, not just the profile row underneath. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgb(9,9,9) 0%, rgb(9,9,9) 28%, rgba(9,9,9,0.94) 44%, rgba(9,9,9,0.72) 60%, rgba(9,9,9,0.38) 76%, rgba(9,9,9,0.12) 90%, rgba(9,9,9,0) 100%)",
          }}
        />

        {/* Soft "stage light" wash centered on the profile row — gives the
            selection area a lit, deliberate focal point instead of just
            fading out to flat black. Picks up a little of both zones above
            (warm from the kids side, cool from the regular side) so it reads
            as a continuation of the scene rather than a bolted-on effect. */}
        <div
          className="absolute inset-x-0 bottom-0 h-[42vh] sm:h-[46vh] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 65% 100% at 50% 100%, rgba(249,115,22,0.14) 0%, rgba(99,102,241,0.08) 42%, transparent 72%)",
          }}
        />

        {/* Thin warm footlight line grounding the row, like a stage edge —
            sits just above where the profile tiles start. */}
        <div
          className="absolute inset-x-0 bottom-24 sm:bottom-28 md:bottom-32 h-px pointer-events-none"
          style={{
            background:
              "linear-gradient(to right, transparent 0%, rgba(249,115,22,0.4) 50%, transparent 100%)",
          }}
        />
      </div>

      {/* The currently-showing slide's title, centered in the screen. No
          truncation anywhere in this block — dynamic sizing (see
          getHeroTitleSizeClass) keeps long titles looking intentional
          instead of clipping them, and the wrapper's max-width + balanced
          wrapping means even a long title always shows in full. Hidden
          entirely during the illustrated fallback state, since that has no
          real title to show. */}
      {activeHeroShow && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center pb-[16vh] sm:pb-[18vh] md:pb-[20vh] px-6 sm:px-10 pointer-events-none">
          <ProfileHeroTitle key={`${activeHeroShow.media_type || "x"}-${activeHeroShow.id}`} show={activeHeroShow} />

          {heroSlideCount > 1 && (
            <div className="flex items-center gap-1.5 mt-6 sm:mt-8 pointer-events-auto">
              {Array.from({ length: heroSlideCount }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setHeroIndex(i)}
                  aria-label={`Show spotlight slide ${i + 1}`}
                  className={`h-1 rounded-full transition-all duration-300 hover:opacity-100 ${
                    i === safeHeroIndex ? "w-6 bg-orange-500" : "w-2 bg-neutral-500/50 hover:bg-neutral-300/70"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onLogout}
        className="absolute top-6 right-5 sm:right-8 z-20 text-[11px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors duration-200 cursor-pointer"
      >
        Log Out
      </button>

      <div
        className={`relative z-10 min-h-screen flex flex-col items-center justify-end px-4 pb-14 sm:pb-16 md:pb-20 transition-opacity duration-300 ${
          selectingId ? "opacity-0" : "opacity-100"
        }`}
      >
        <p className="text-[11px] font-mono uppercase tracking-widest text-neutral-500 mb-1.5">{account.username}</p>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight mb-6 sm:mb-8 text-center drop-shadow-lg">
          Who&apos;s Watching?
        </h1>

        {/* Locked to a single row — never wraps. On a screen too narrow to
            fit every tile, the row scrolls horizontally instead of
            breaking into a second line. `overflow-x-auto` here has the same
            side effect described on the homepage shelves (see ScrollShelf
            in cardHelpers.tsx): once one axis isn't `visible`, the other
            axis is forced from `visible` to `auto` too — so without
            headroom, a selected/hovered tile's glow and scale-up got its
            top edge sliced off by this container instead of rendering in
            full. The padding gives it room; the matching negative margin
            cancels that extra height back out so the row still sits in the
            same place relative to the heading above it. */}
        <div className="w-full max-w-5xl overflow-x-auto overflow-y-hidden scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pt-12 -mt-12 pb-4 -mb-4">
          <div className="flex flex-nowrap items-start justify-center gap-3 sm:gap-5 md:gap-6 px-2 mx-auto w-max min-w-full">
            {profiles.map((profile, index) => (
              <ProfileBox
                key={profile.id}
                profile={profile}
                manageMode={manageMode}
                selected={selectingId === profile.id}
                index={index}
                onClick={() => (manageMode ? setModal({ mode: "edit", profile }) : handleSelect(profile))}
              />
            ))}

            {profiles.length < MAX_PROFILES && !manageMode && (
              <AddProfileTile onClick={() => setModal({ mode: "create" })} />
            )}

            <ManageToggleTile manageMode={manageMode} onClick={() => setManageMode((m) => !m)} />
          </div>
        </div>
      </div>

      {modal && (
        <ProfileModal
          account={account}
          profiles={profiles}
          modal={modal}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// Bigger text for a short punchy title, smaller for a long one — same idea
// Netflix-style spotlights use so a title never looks like it's fighting
// its own container, whether it's "Him" or "The Lord of the Rings: The
// Fellowship of the Ring".
function getHeroTitleSizeClass(title: string): string {
  const len = title.length;
  if (len <= 14) return "text-4xl sm:text-6xl md:text-7xl";
  if (len <= 24) return "text-3xl sm:text-5xl md:text-6xl";
  if (len <= 36) return "text-2xl sm:text-4xl md:text-5xl";
  return "text-xl sm:text-3xl md:text-4xl";
}

// The centered title block itself. Keyed by the caller on the show's
// id/media_type, so React remounts it (not just re-renders it) on every
// slide change — that's what lets this do a clean fade-and-rise-in each
// time instead of the text just snapping to the new value.
function ProfileHeroTitle({ show }: { show: AnimeCard }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const title = getDisplayTitle(show);
  const rating = typeof show.averageScore === "number" ? (show.averageScore / 10).toFixed(1) : null;

  return (
    <div
      className={`flex flex-col items-center text-center max-w-[92vw] sm:max-w-3xl md:max-w-4xl transition-all duration-700 ease-out ${
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      }`}
    >
      <p className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.25em] text-orange-400/90 mb-3 sm:mb-4">
        {show.media_type === "movie" ? "Movie" : "TV Show"} Spotlight
      </p>

      {/* No line-clamp, no truncation — `balance` wrapping plus the
          dynamic size above means the whole title always renders, and
          wraps evenly across lines instead of leaving an orphan word. */}
      <h2
        className={`text-white font-black tracking-tight leading-[1.08] drop-shadow-[0_6px_28px_rgba(0,0,0,0.7)] ${getHeroTitleSizeClass(
          title
        )}`}
        style={{ textWrap: "balance" } as CSSProperties}
      >
        {title}
      </h2>

      {(rating || show.seasonYear) && (
        <div className="flex items-center gap-3 mt-4 sm:mt-5 text-xs sm:text-sm font-semibold text-neutral-200">
          {rating && (
            <span className="flex items-center gap-1 text-orange-400">
              <span>★</span>
              {rating}
            </span>
          )}
          {rating && show.seasonYear && <span className="text-neutral-600 font-normal">|</span>}
          {show.seasonYear && <span>{show.seasonYear}</span>}
        </div>
      )}
    </div>
  );
}

// Real, rotating key art for the profile-select background. Purely
// presentational — `activeIndex` is owned by ProfilePage (same controlled
// pattern the homepage HeroSlider uses) — this just renders the right
// slide and pre-warms the next one slightly ahead of time so the rotation
// never stalls on a network request mid-transition. Falls back to the
// illustrated scene while the trending fetch is still loading or if it
// ever comes back empty.
function ProfileHeroBackdrop({
  items,
  loading,
  activeIndex,
}: {
  items: AnimeCard[];
  loading: boolean;
  activeIndex: number;
}) {
  const prefetchedRef = useRef<Set<string>>(new Set());
  const slideCount = Math.min(items.length, HERO_SLIDE_COUNT);
  const safeIndex = slideCount > 0 ? Math.min(activeIndex, slideCount - 1) : 0;

  useEffect(() => {
    if (slideCount === 0) return;
    const next = items[(safeIndex + 1) % slideCount];
    const src = next && getDisplayCover(next);
    if (!src || prefetchedRef.current.has(src)) return;
    prefetchedRef.current.add(src);
    const img = new Image();
    img.src = src;
  }, [safeIndex, slideCount, items]);

  if (loading || slideCount === 0) {
    return <ProfileHeroIllustration />;
  }

  return (
    <div className="absolute inset-0">
      {items.slice(0, HERO_SLIDE_COUNT).map((show, i) => (
        <img
          key={`${show.media_type || "x"}-${show.id}`}
          src={getDisplayCover(show)}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-out ${
            i === safeIndex ? "opacity-100" : "opacity-0"
          }`}
          loading={i === safeIndex ? "eager" : "lazy"}
          decoding="async"
        />
      ))}
    </div>
  );
}

// The original illustrated scene — plain inline SVG, nothing to fetch,
// nothing that can fail to load. Kept as the fallback for the brief moment
// before real trending art has loaded (or on the rare chance the fetch
// comes back empty), so there's never a blank box behind the profile row.
function ProfileHeroIllustration() {
  return (
    <svg
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="pgKidsBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c2410c" />
          <stop offset="100%" stopColor="#a16207" />
        </linearGradient>
        <linearGradient id="pgRegularBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e1b4b" />
          <stop offset="100%" stopColor="#0b1224" />
        </linearGradient>
        <radialGradient id="pgSun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff7ed" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff7ed" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pgSeamBlend" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="50%" stopColor="#0a0a0a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#0a0a0a" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="1600" height="900" fill="#0a0a0a" />

      {/* Kids side — warm, playful: soft sun glow, rounded cloud
          blobs, scattered stars. */}
      <rect x="0" y="0" width="880" height="900" fill="url(#pgKidsBg)" opacity="0.55" />
      <circle cx="270" cy="230" r="220" fill="url(#pgSun)" />
      <circle cx="270" cy="230" r="70" fill="#fff7ed" opacity="0.35" />
      <g fill="#fff7ed" opacity="0.22">
        <ellipse cx="150" cy="480" rx="120" ry="46" />
        <ellipse cx="230" cy="510" rx="90" ry="38" />
        <ellipse cx="470" cy="380" rx="100" ry="40" />
        <ellipse cx="540" cy="410" rx="70" ry="30" />
      </g>
      <g fill="#fde68a" opacity="0.5">
        <circle cx="620" cy="150" r="5" />
        <circle cx="700" cy="260" r="4" />
        <circle cx="120" cy="120" r="4" />
        <circle cx="400" cy="90" r="3" />
        <circle cx="60" cy="330" r="3" />
      </g>

      {/* Regular side — cooler, cinematic: crossed spotlight beams,
          faint horizon line. */}
      <rect x="720" y="0" width="880" height="900" fill="url(#pgRegularBg)" opacity="0.65" />
      <g opacity="0.16" fill="#e2e8f0">
        <polygon points="1180,0 1330,0 1600,780 1450,900" />
        <polygon points="1330,0 1440,0 1600,520 1600,780" />
      </g>
      <line x1="720" y1="560" x2="1600" y2="560" stroke="#e2e8f0" strokeOpacity="0.08" strokeWidth="2" />

      {/* Soft seam so the two halves blend instead of a hard split */}
      <rect x="560" y="0" width="480" height="900" fill="url(#pgSeamBlend)" />
    </svg>
  );
}

// Shared tile sizing so ProfileBox / AddProfileTile / ManageToggleTile all
// line up in the row at the same height regardless of icon vs. photo content.
const TILE_SIZE = "w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24";
const TILE_WRAPPER = "w-16 sm:w-20 md:w-24 flex-shrink-0 flex flex-col items-center space-y-1.5 sm:space-y-2 group cursor-pointer";

function ProfileBox({
  profile,
  manageMode,
  selected,
  onClick,
  index = 0,
}: {
  profile: SupabaseProfile;
  manageMode: boolean;
  selected: boolean;
  onClick: () => void;
  index?: number;
}) {
  // Small staggered fade/rise-in per tile so the row reveals itself
  // deliberately instead of every profile snapping onto screen at once.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 60 + index * 50);
    return () => window.clearTimeout(t);
  }, [index]);

  return (
    <button
      onClick={onClick}
      className={`${TILE_WRAPPER} transition-all duration-300 ease-out ${
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      } ${selected ? "scale-105" : "hover:-translate-y-1 hover:scale-[1.03]"}`}
    >
      <div
        className={`relative ${TILE_SIZE} rounded-lg overflow-hidden border-2 transition-all duration-200 ${
          selected
            ? "border-orange-500 shadow-[0_0_24px_4px_rgba(249,115,22,0.45)]"
            : manageMode
            ? "border-neutral-600"
            : "border-transparent group-hover:border-orange-500 group-hover:shadow-[0_0_16px_2px_rgba(249,115,22,0.25)]"
        }`}
      >
        <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover bg-neutral-900" />
        {manageMode && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-xl sm:text-2xl">✎</span>
          </div>
        )}
        {profile.is_kids && (
          <span className="absolute bottom-1 right-1 flex items-center text-[6px] sm:text-[7px] md:text-[8px] font-bold uppercase tracking-wider text-orange-300 bg-neutral-950/90 backdrop-blur-sm border border-orange-400/40 rounded-full px-1.5 py-[1.5px] leading-none">
            Kids
          </span>
        )}
      </div>
      <span className="text-[10px] sm:text-xs font-mono text-neutral-300 group-hover:text-white transition-colors duration-200 truncate max-w-full">
        {profile.name}
      </span>
    </button>
  );
}

// The "+" tile for adding a new profile — folded into the same single row
// as everything else instead of floating separately below it.
function AddProfileTile({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Add Profile" className={`${TILE_WRAPPER} transition-transform duration-200 hover:-translate-y-1`}>
      <div
        className={`${TILE_SIZE} rounded-lg border-2 border-dashed border-neutral-600 flex items-center justify-center text-2xl sm:text-3xl text-neutral-500 group-hover:border-orange-500 group-hover:text-orange-500 transition-colors duration-200`}
      >
        +
      </div>
      <span className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-neutral-500 group-hover:text-neutral-200 transition-colors duration-200 text-center leading-tight">
        Add Profile
      </span>
    </button>
  );
}

// Replaces the old standalone "Manage Profiles" button below the grid —
// it's now just the last tile in the row, matching how the reference layout
// puts Edit directly alongside the profiles instead of as a separate action.
function ManageToggleTile({ manageMode, onClick }: { manageMode: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={manageMode}
      aria-label={manageMode ? "Done editing profiles" : "Edit profiles"}
      className={`${TILE_WRAPPER} transition-transform duration-200 hover:-translate-y-1`}
    >
      <div
        className={`${TILE_SIZE} rounded-lg border-2 flex items-center justify-center text-lg sm:text-xl transition-colors duration-200 ${
          manageMode
            ? "border-orange-500 text-orange-500 bg-orange-500/10"
            : "border-neutral-600 text-neutral-500 group-hover:border-neutral-300 group-hover:text-neutral-200"
        }`}
      >
        {manageMode ? "✓" : "✎"}
      </div>
      <span className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-neutral-500 group-hover:text-neutral-200 transition-colors duration-200">
        {manageMode ? "Done" : "Edit"}
      </span>
    </button>
  );
}

function ProfileModal({
  account,
  profiles,
  modal,
  onClose,
  onSaved,
}: {
  account: SupabaseAccount;
  profiles: SupabaseProfile[];
  modal: Exclude<ModalState, null>;
  onClose: () => void;
  onSaved: (profiles: SupabaseProfile[]) => void;
}) {
  const editing = modal.mode === "edit" ? modal.profile : null;
  const [name, setName] = useState(editing?.name || "");
  const [icon, setIcon] = useState(editing?.avatar_url || "");
  const [isKids, setIsKids] = useState(editing?.is_kids || false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editing) {
        await updateProfile(editing.id, { name: name.trim(), avatar_url: icon, is_kids: isKids });
        onSaved(profiles.map((p) => (p.id === editing.id ? { ...p, name: name.trim(), avatar_url: icon, is_kids: isKids } : p)));
      } else {
        const created = await createProfile(account.id, name, icon, isKids);
        onSaved([...profiles, created]);
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm(`Delete the profile "${editing.name}"? This can't be undone.`)) return;
    setSubmitting(true);
    try {
      await deleteProfile(editing.id);
      onSaved(profiles.filter((p) => p.id !== editing.id));
    } catch (err: any) {
      setError(err?.message || "Couldn't delete this profile.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4 py-8"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[#0f0d0a] border border-neutral-800 rounded-xl shadow-2xl p-6 space-y-5 max-h-full overflow-y-auto"
      >
        <h2 className="text-lg font-black tracking-tight">{editing ? "Edit Profile" : "Add Profile"}</h2>

        <div className="space-y-1.5">
          <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">Profile Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={20}
            className="w-full px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800 text-sm placeholder-neutral-600 focus:outline-none focus:border-orange-500 transition duration-200"
            placeholder="e.g. Alex"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">Choose an Icon</label>
          <IconPicker value={icon} onChange={setIcon} />
        </div>

        <div className="flex items-center justify-between bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Kids Profile</p>
            <p className="text-[11px] text-neutral-500">Hides mature/adult-tagged content</p>
          </div>
          <button
            type="button"
            onClick={() => setIsKids((v) => !v)}
            className={`w-11 h-6 rounded-full transition-colors duration-200 relative shrink-0 cursor-pointer ${
              isKids ? "bg-orange-500" : "bg-neutral-700"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all duration-200 ${
                isKids ? "left-5" : "left-0.5"
              }`}
            />
          </button>
        </div>

        {error && (
          <p className="text-xs font-mono text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex items-center space-x-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-2.5 rounded-md bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-sm font-bold uppercase tracking-widest transition duration-200 cursor-pointer"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-md border border-neutral-800 hover:border-neutral-600 text-sm font-semibold transition duration-200 cursor-pointer"
          >
            Cancel
          </button>
        </div>

        {editing && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="w-full text-xs font-mono uppercase tracking-widest text-neutral-500 hover:text-red-400 transition duration-200 cursor-pointer"
          >
            Delete Profile
          </button>
        )}
      </form>
    </div>
  );
}
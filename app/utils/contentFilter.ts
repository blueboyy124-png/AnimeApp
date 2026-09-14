import { useEffect, useState } from "react";

// Filters mature-tagged items out of a feed/search result list when the
// active profile is a kids profile. Checks the common shapes the AniList
// and TMDB-backed endpoints return (genres array, isAdult flag). This is
// the fast, synchronous, zero-network first pass — it runs immediately on
// every list, anime included, before anything ever reaches the screen.
export function filterForKids<T extends { genres?: string[]; isAdult?: boolean }>(
  items: T[],
  isKids: boolean
): T[] {
  if (!isKids) return items;
  return items.filter((item) => {
    if (item.isAdult) return false;
    const genres = (item.genres || []).map((g) => g.toLowerCase());
    return !genres.includes("hentai") && !genres.includes("ecchi") && !genres.includes("erotica");
  });
}

// --- TMDB certification-based filtering (movies/TV) -----------------------
//
// A Netflix Kids-style cutoff: only TV-Y, TV-Y7, TV-Y7-FV, TV-G, and TV-PG
// pass for TV; only G and PG pass for movies. Everything at or above
// TV-14/PG-13 is blocked, matching what Netflix Kids actually restricts to.
//
// TMDB's search/trending/recommendation endpoints don't include a
// certification inline — it's a separate call per title
// (release_dates for movies, content_ratings for TV). To keep this fast:
//   - results are cached in-memory per session, keyed by "movie-123"/"tv-456",
//     so paginating or re-rendering never re-fetches a title already checked
//   - all lookups for a given list run in parallel via Promise.all
//
// A title with no US certification on file can't be confirmed safe, so it's
// excluded rather than assumed fine — the failure mode here should always
// be "hidden from kids" rather than "possibly shown to kids".

// SECURITY: this used to be a hardcoded literal. Any key baked directly into
// this file ships to the browser in plaintext — anyone can read it out of
// devtools -> Sources and use it under your TMDB quota. Set
// NEXT_PUBLIC_TMDB_API_KEY in your env instead. For real protection this
// call should eventually move behind your own backend so the key never
// reaches the client at all.
const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY || "";

const KIDS_SAFE_MOVIE_RATINGS = new Set(["G", "PG"]);
const KIDS_SAFE_TV_RATINGS = new Set(["TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG"]);

const ratingCache = new Map<string, string | null>();

async function fetchMovieCertification(id: string | number): Promise<string | null> {
  const cacheKey = `movie-${id}`;
  if (ratingCache.has(cacheKey)) return ratingCache.get(cacheKey)!;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_API_KEY}`);
    const data = await res.json();
    const us = (data.results || []).find((r: any) => r.iso_3166_1 === "US");
    const cert: string | null = us?.release_dates?.find((rd: any) => rd.certification)?.certification || null;
    ratingCache.set(cacheKey, cert);
    return cert;
  } catch {
    ratingCache.set(cacheKey, null);
    return null;
  }
}

async function fetchTvRating(id: string | number): Promise<string | null> {
  const cacheKey = `tv-${id}`;
  if (ratingCache.has(cacheKey)) return ratingCache.get(cacheKey)!;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${id}/content_ratings?api_key=${TMDB_API_KEY}`);
    const data = await res.json();
    const us = (data.results || []).find((r: any) => r.iso_3166_1 === "US");
    const rating: string | null = us?.rating || null;
    ratingCache.set(cacheKey, rating);
    return rating;
  } catch {
    ratingCache.set(cacheKey, null);
    return null;
  }
}

// Second pass: only touches items with media_type "movie"/"tv" (anime and
// everything else already cleared the synchronous genre check above and
// has no US TV rating on TMDB to check anyway).
export async function filterMatureRatings<T extends { id: string | number; media_type?: string }>(
  items: T[],
  isKids: boolean
): Promise<T[]> {
  if (!isKids) return items;

  const checked: (T | null)[] = await Promise.all(
    items.map(async (item) => {
      if (item.media_type === "movie") {
        const cert = await fetchMovieCertification(item.id);
        return cert !== null && KIDS_SAFE_MOVIE_RATINGS.has(cert) ? item : null;
      }
      if (item.media_type === "tv") {
        const rating = await fetchTvRating(item.id);
        return rating !== null && KIDS_SAFE_TV_RATINGS.has(rating) ? item : null;
      }
      return item;
    })
  );

  return checked.filter((item): item is T => item !== null);
}

// Convenience hook wrapping the async pass above: takes whatever list a
// component already computed synchronously (via filterForKids) and, for
// kids profiles, further narrows it down by real TMDB certification.
// `loading` is true only while a kids-profile check is in flight — callers
// should avoid rendering the pre-filter list during that window, so nothing
// above a kids' cutoff has a chance to flash on screen before the async
// check resolves.
export function useKidsSafeList<T extends { id: string | number; media_type?: string }>(
  list: T[],
  isKids: boolean
): { list: T[]; loading: boolean } {
  // Tracks the last (key, isKids) combination that was actually checked and
  // resolved, plus the safe result for it.
  const [resolved, setResolved] = useState<{ key: string; isKids: boolean; safeList: T[] }>({
    key: "",
    isKids: false,
    safeList: [],
  });

  // A content-based key (not the array reference, which changes every
  // render) so we only re-check when the actual items or the profile
  // change, not on every unrelated re-render.
  const listKey = list.map((i) => `${i.media_type || "anime"}-${i.id}`).join(",");

  // Computed synchronously on every render — true the instant isKids or the
  // list changes, even before the effect below has had a chance to run.
  // This is what closes the flash-of-unfiltered-content gap: a plain
  // effect-driven `loading` flag would still lag one render behind a
  // profile switch, briefly returning the old (wrong-profile) safeList.
  const isStale = resolved.key !== listKey || resolved.isKids !== isKids;
  const loading = isKids && isStale;

  useEffect(() => {
    if (!isKids) {
      setResolved({ key: listKey, isKids: false, safeList: list });
      return;
    }
    let cancelled = false;
    filterMatureRatings(list, true).then((safe) => {
      if (!cancelled) setResolved({ key: listKey, isKids: true, safeList: safe });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, isKids]);

  if (!isKids) return { list, loading: false };
  // While stale/loading, return nothing rather than the previous profile's
  // (or previous list's) resolved results — never show a kids profile
  // content that hasn't been rating-checked for *this* list yet.
  return { list: loading ? [] : resolved.safeList, loading };
}
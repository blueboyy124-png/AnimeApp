import { useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { loadSourceCache, saveSourceCache } from "../lib/sourceCache";
import { getResumeTimeKey } from "../lib/history";

export function useWatchRoute() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const pathname     = usePathname();

  const urlProvider = searchParams.get("provider");
  const mediaType   = searchParams.get("type") ?? searchParams.get("mediaType") ?? "anime";
  const anilistId   = searchParams.get("id") ?? searchParams.get("anilistId") ?? searchParams.get("tmdbId") ?? "0";
  const category    = searchParams.get("category");
  const rawSlug     = searchParams.get("slug")       ?? "";
  const epNum       = searchParams.get("epNum")      ?? "1";
  const seasonNum   = searchParams.get("season")     ?? "1";
  const queryString = searchParams.toString();

  const currentSlug = rawSlug
    ? (rawSlug.includes("watch/") ? rawSlug.split("/").pop() ?? rawSlug : rawSlug)
    : "";

  const isExternalMedia = 
    mediaType === "movie" || 
    mediaType === "series" || 
    mediaType === "tv" || 
    urlProvider === "tmdb" || 
    urlProvider === "omdb" || 
    /^tmdb-(?:movie|tv)-/i.test(anilistId) ||
    /^tt\d+/i.test(anilistId);

  const isExternalMovie = 
    mediaType === "movie" ||
    /^tmdb-movie-/i.test(anilistId) ||
    (isExternalMedia && !/^tt/i.test(currentSlug) && mediaType !== "series" && mediaType !== "tv" && !/^tmdb-tv-/i.test(anilistId));

  const activeCategory = category ?? "sub";
  const provider = urlProvider ?? (isExternalMedia ? "dahmermovies" : "kiwi");

  const mediaIdentity = `${isExternalMedia ? "external" : "anime"}:${mediaType}:${anilistId}`;
  const routeIdentity = `${mediaIdentity}:${seasonNum}:${epNum}:${provider}:${activeCategory}:${currentSlug}`;

  // Synchronize language and provider preferences with localStorage & query string
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const savedLang = localStorage.getItem("streamanime_pref_lang") ?? "sub";
      const savedProv = localStorage.getItem("streamanime_pref_provider");

      let parametersChanged = false;
      const nextParams = new URLSearchParams(queryString);

      if (!category) {
        nextParams.set("category", savedLang);
        parametersChanged = true;
      } else {
        localStorage.setItem("streamanime_pref_lang", category);
      }

      if (!urlProvider) {
        if (isExternalMedia) {
          nextParams.set("provider", "dahmermovies");
          parametersChanged = true;
        } else if (savedProv) {
          nextParams.set("provider", savedProv);
          parametersChanged = true;
        }
      } else {
        localStorage.setItem("streamanime_pref_provider", urlProvider);
      }

      if (parametersChanged) {
        router.replace(`${pathname}?${nextParams.toString()}`);
      }
    } catch {
      // localStorage unavailable — prefs fall back to defaults
    }
  }, [category, urlProvider, queryString, pathname, router, isExternalMedia]);

  const handleCategoryChange = useCallback((
    target: "sub" | "dub",
    options: {
      subSlug: string | null;
      dubSlug: string | null;
      videoElement: HTMLVideoElement | null;
      savedTimeRef: React.MutableRefObject<number>;
      destroyHls: () => void;
      setLoading: (v: boolean) => void;
      setIsPlaying: (v: boolean) => void;
    }
  ) => {
    if (isExternalMedia) return;
    if (target === activeCategory) return;
    try {
      localStorage.setItem("streamanime_pref_lang", target);
    } catch {}
    const targetedSlug = target === "dub" ? options.dubSlug : options.subSlug;
    if (!targetedSlug) return;
    if (options.videoElement && isFinite(options.videoElement.currentTime)) {
      options.savedTimeRef.current = options.videoElement.currentTime;
      try {
        localStorage.setItem(getResumeTimeKey(anilistId, epNum), String(options.videoElement.currentTime));
      } catch {}
    }
    options.setIsPlaying(false);
    options.destroyHls();
    options.setLoading(true);
    const p = new URLSearchParams(queryString);
    p.set("category", target);
    p.set("slug", targetedSlug);
    router.push(`${pathname}?${p.toString()}`);
  }, [activeCategory, anilistId, epNum, isExternalMedia, pathname, queryString, router]);

  const handleProviderChange = useCallback((
    newProvider: string,
    options: {
      videoElement: HTMLVideoElement | null;
      savedTimeRef: React.MutableRefObject<number>;
      destroyHls: () => void;
      setLoading: (v: boolean) => void;
      setIsPlaying: (v: boolean) => void;
    }
  ) => {
    if (newProvider === provider) return;
    try {
      localStorage.setItem("streamanime_pref_provider", newProvider);
    } catch {}
    if (options.videoElement && isFinite(options.videoElement.currentTime)) {
      options.savedTimeRef.current = options.videoElement.currentTime;
      try {
        localStorage.setItem(getResumeTimeKey(anilistId, epNum), String(options.videoElement.currentTime));
      } catch {}
    }
    // Purge stale source cache entry for the new provider so it doesn't get
    // a hit on the old provider's cached stream URL when the pipeline re-runs.
    const staleCacheKey = `${newProvider}:${anilistId}:${activeCategory}:${epNum}`;
    const cache = loadSourceCache();
    if (cache[staleCacheKey]) {
      delete cache[staleCacheKey];
      saveSourceCache(cache);
    }
    options.setIsPlaying(false);
    options.destroyHls();
    options.setLoading(true);
    const p = new URLSearchParams(queryString);
    p.set("provider", newProvider);
    p.set("slug", "");
    router.replace(`${pathname}?${p.toString()}`);
  }, [activeCategory, anilistId, epNum, pathname, provider, queryString, router]);

  return {
    searchParams,
    router,
    pathname,
    urlProvider,
    mediaType,
    anilistId,
    category,
    rawSlug,
    epNum,
    seasonNum,
    queryString,
    currentSlug,
    isExternalMedia,
    isExternalMovie,
    activeCategory,
    provider,
    mediaIdentity,
    routeIdentity,
    handleCategoryChange,
    handleProviderChange,
  };
}


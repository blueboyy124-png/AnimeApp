import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  TARGET_MAX_HEIGHT,
  STREAM_LOAD_TIMEOUT_MS,
  STREAM_LOAD_TIMEOUT_EXTENDED_MS,
  PERSISTENT_SOURCE_CACHE_TTL_MS,
} from "../lib/constants";
import {
  isAppleMobileDevice,
  waitForRetry,
  fetchWithRetry,
} from "../lib/utils";
import {
  loadPersistentSourceCache,
  savePersistentSourceCache,
  invalidateFailedSource,
  markSourceHealthy,
} from "../lib/sourceCache";
import {
  loadProviderPref,
  saveProviderPref,
  markProviderFailure,
  clearProviderFailure,
  isProviderSuppressed,
} from "../lib/providerHealth";
import { cappedLevelIndexFor, bestStartupLevelIndex } from "../lib/hlsLevels";
import { getTmdbEmbedApiUrl } from "../../utils/api";

const TMDB_EMBED_API = getTmdbEmbedApiUrl();

interface UseExternalStreamOptions {
  isExternalMedia: boolean;
  isExternalMovie: boolean;
  anilistId: string;
  epNum: string;
  seasonNum: string;
  activeCategory: string;
  provider: string;
  currentSlug: string;
  mediaType: string;
  routeIdentity: string;
  activeRouteIdentityRef: React.MutableRefObject<string>;
  playbackGenerationRef: React.MutableRefObject<number>;
  sourceAttemptRef: React.MutableRefObject<number>;
  sourceStateRef: React.MutableRefObject<"idle" | "pending" | "healthy" | "failed">;
  activeSourceUrlRef: React.MutableRefObject<string | null>;
  playbackHasStartedRef: React.MutableRefObject<boolean>;
  playbackSourceReadyRef: React.MutableRefObject<boolean>;
  mediaFailureHandlerRef: React.MutableRefObject<(() => void) | null>;
  mediaSuccessHandlerRef: React.MutableRefObject<(() => void) | null>;
  mediaProgressHandlerRef: React.MutableRefObject<(() => void) | null>;
  streamTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  stallRecoveryTimerRef: React.MutableRefObject<number | null>;
  savedTimeRef: React.MutableRefObject<number>;
  forceStartFromZeroRef: React.MutableRefObject<boolean>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hlsRef: React.MutableRefObject<any>;
  destroyHls: () => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setStatus: (v: string) => void;
  setExternalStreamUrl: (url: string | null) => void;
  setAvailableProviders: (providers: string[]) => void;
  setEpisodeTitle: React.Dispatch<React.SetStateAction<string>>;
  setVideoQuality: (q: string) => void;
  resetSkipState: () => void;
  autoplay: boolean;
  pathname: string;
  router: ReturnType<typeof useRouter>;
  queryString: string;
}

export function useExternalStream({
  isExternalMedia,
  isExternalMovie,
  anilistId,
  epNum,
  seasonNum,
  activeCategory,
  provider,
  currentSlug,
  mediaType,
  routeIdentity,
  activeRouteIdentityRef,
  playbackGenerationRef,
  sourceAttemptRef,
  sourceStateRef,
  activeSourceUrlRef,
  playbackHasStartedRef,
  playbackSourceReadyRef,
  mediaFailureHandlerRef,
  mediaSuccessHandlerRef,
  mediaProgressHandlerRef,
  streamTimeoutRef,
  stallRecoveryTimerRef,
  savedTimeRef,
  forceStartFromZeroRef,
  videoRef,
  hlsRef,
  destroyHls,
  setLoading,
  setError,
  setStatus,
  setExternalStreamUrl,
  setAvailableProviders,
  setEpisodeTitle,
  setVideoQuality,
  resetSkipState,
  autoplay,
  pathname,
  router,
  queryString,
}: UseExternalStreamOptions) {
  useEffect(() => {
    if (!isExternalMedia) return;

    let cancelled = false;
    const requestController = new AbortController();
    const generation = playbackGenerationRef.current;
    const transaction = {
      id: `${routeIdentity}:${generation}`,
      mediaFamily: "external" as const,
      titleId: String(anilistId),
      season: String(seasonNum || "1"),
      episode: String(epNum),
      category: activeCategory,
      provider: String(provider),
      slug: String(currentSlug || ""),
      generation,
    };
    const isStale = () => cancelled || generation !== playbackGenerationRef.current ||
      activeRouteIdentityRef.current !== routeIdentity;

    async function runExternal() {
      try {
        const pipelineStartedAt = Date.now();
        if (isStale()) return;
        setLoading(true);
        setError(null);
        setExternalStreamUrl(null);
        setStatus(isExternalMovie ? "Locating movie stream..." : "Locating episode stream...");
        destroyHls();
        resetSkipState();

        const tmdbId = anilistId.replace(/^tmdb-(?:movie|tv)-/i, "");
        if (!/^\d+$/.test(tmdbId)) {
          throw new Error("This title is missing its TMDB ID, so its movie/TV providers cannot be queried.");
        }

        let enabledProviders: string[] = [];
        try {
          const providersRes = await fetchWithRetry(
            `${TMDB_EMBED_API}/api/providers`,
            { signal: requestController.signal },
            { attempts: 3, label: "TMDB provider list" }
          );
          const providersData = providersRes.ok ? await providersRes.json() : null;
          enabledProviders = Array.isArray(providersData?.providers)
            ? providersData.providers
              .filter((item: any) => item?.enabled && item?.name)
              .map((item: any) => String(item.name))
            : [];
          if (!cancelled) setAvailableProviders(enabledProviders);
        } catch {}

        // Persistent cache + provider preference (media-type aware)
        const mediaTypeKey = isExternalMovie ? "movie" : "tv";
        const persistentCacheKey = `${mediaTypeKey}:${anilistId}:${seasonNum || "1"}:${epNum}:${activeCategory}:${provider}:${currentSlug || "-"}`;
        const persistentCache = loadPersistentSourceCache();
        const cachedEntry = persistentCache[persistentCacheKey];
        const persistentHit =
          cachedEntry &&
          cachedEntry.url &&
          (!cachedEntry.transactionId || cachedEntry.transactionId === transaction.id) &&
          cachedEntry.healthy !== false &&
          Date.now() - (cachedEntry.cachedAt || 0) < PERSISTENT_SOURCE_CACHE_TTL_MS;

        const manualPref = typeof window !== "undefined" ? localStorage.getItem("streamanime_pref_provider") : null;
        const providerPref = loadProviderPref();
        const savedTypePref = providerPref[mediaTypeKey];
        const healthyEnabledProviders = enabledProviders.filter((name) => !isProviderSuppressed(name));
        const externalFallback = healthyEnabledProviders.includes("dahmermovies")
          ? "dahmermovies"
          : healthyEnabledProviders[0] || enabledProviders[0] || "";

        const selectedProvider = provider && enabledProviders.includes(provider)
          ? provider
          : manualPref && enabledProviders.includes(manualPref)
          ? manualPref
          : savedTypePref && enabledProviders.includes(savedTypePref)
          ? savedTypePref
          : externalFallback;

        if (selectedProvider && selectedProvider !== provider) {
          const params = new URLSearchParams(queryString);
          params.set("provider", selectedProvider);
          router.replace(`${pathname}?${params.toString()}`);
          return;
        }

        let streamsArray: any[] = [];
        const streamPath = isExternalMovie
          ? `movie/${tmdbId}`
          : `series/${tmdbId}?season=${encodeURIComponent(seasonNum)}&episode=${encodeURIComponent(epNum)}`;

        if (persistentHit && cachedEntry?.url) {
          let cacheValid = false;
          try {
            const probe = await fetchWithRetry(
              cachedEntry.url,
              { method: "HEAD", signal: requestController.signal },
              { attempts: 2, label: "cached stream probe" }
            );
            cacheValid = probe.ok || probe.status === 206;
          } catch {
            cacheValid = false;
          }
          if (cacheValid) {
            streamsArray = [{ url: cachedEntry.url, name: cachedEntry.name || selectedProvider }];
            setStatus("Playback ready (cached)");
          } else {
            delete persistentCache[persistentCacheKey];
            savePersistentSourceCache(persistentCache);
            console.warn(`[watch] Persistent cache entry invalid, re-resolving: ${persistentCacheKey}`);
          }
        }

        if (isStale()) return;
        if (streamsArray.length === 0) {
          const endpoint = `${TMDB_EMBED_API}/api/streams/${streamPath}`;
          const res = await fetchWithRetry(
            endpoint,
            { signal: requestController.signal },
            { attempts: 3, label: "TMDB stream lookup" }
          );
          if (!res.ok) throw new Error(`Stream lookup failed: ${res.status} ${res.statusText}`);

          const data = await res.json();
          streamsArray = data?.streams || data?.results || [];
        }

        if (streamsArray.length === 0) {
          throw new Error("No operational provider links found on your server backend response map.");
        }

        interface ScoredStream {
          url: string;
          name: string;
          score: number;
        }

        let valid: { url: string; name: string }[] = [];

        if (Array.isArray(streamsArray)) {
          const getQualityScore = (stream: any): number => {
            if (!stream) return 0;
            const metadata = [stream.quality, stream.resolution, stream.name, stream.title, stream.provider]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            if (metadata.includes('2160') || metadata.includes('4k')) return 2160; 
            if (metadata.includes('1080') || metadata.includes('fhd')) return 1080;
            if (metadata.includes('720') || metadata.includes('hd')) return 720;
            if (metadata.includes('480') || metadata.includes('sd')) return 480;
            if (metadata.includes('360')) return 360;
            return 0;
          };

          const scoredStreams: ScoredStream[] = [];
          for (const s of streamsArray) {
            if (s && typeof s.url === 'string') {
              let cleanUrl = s.url.trim();
              const urlNoQuery = cleanUrl.split('?')[0].toLowerCase();
              if (urlNoQuery.endsWith('.mkv')) continue;

              if (cleanUrl.startsWith('//')) {
                cleanUrl = 'https:' + cleanUrl;
              } else if (cleanUrl.startsWith('/')) {
                cleanUrl = 'https://showbox.media' + cleanUrl;
              }

              scoredStreams.push({ 
                url: cleanUrl, 
                name: String(s.name || s.title || s.provider || "Provider Source"), 
                score: getQualityScore(s)
              });
            }
          }

          scoredStreams.sort((a, b) => {
            if (typeof selectedProvider === 'string' && selectedProvider.trim() !== '') {
              const target = selectedProvider.toLowerCase();
              const aIsPref = a.name.toLowerCase().includes(target);
              const bIsPref = b.name.toLowerCase().includes(target);
              if (aIsPref && !bIsPref) return -1;
              if (!aIsPref && bIsPref) return 1;
            }
            return b.score - a.score;
          });

          valid = scoredStreams.map(stream => ({
            url: stream.url,
            name: stream.name
          }));
        }

        if (valid.length === 0) {
          throw new Error("No browser compatible player links remaining inside response payload.");
        }

        if (isStale() || !videoRef.current) return;
        console.info("[watch] primary external stream ready", {
          provider: selectedProvider,
          ms: Date.now() - pipelineStartedAt,
        });

        let initialTime = 0;
        if (forceStartFromZeroRef.current) {
          forceStartFromZeroRef.current = false;
          savedTimeRef.current = 0;
        } else if (savedTimeRef.current > 0) {
          initialTime = savedTimeRef.current;
          savedTimeRef.current = 0;
        } else {
          try {
            const activeId = localStorage.getItem("streamanime_active_profile_id");
            const storageKey = activeId
              ? `streamanime_watch_history_${activeId}`
              : "streamanime_watch_history";
            const raw = localStorage.getItem(storageKey);
            if (raw) {
              const list = JSON.parse(raw);
              const log = list.find(
                (item: any) =>
                  String(item.anilistId) === String(anilistId) &&
                  String(item.episodeNumber) === String(epNum) &&
                  (isExternalMovie || String(item.season ?? "1") === String(seasonNum))
              );
              if (log && log.currentTime > 5) {
                if (!log.duration || log.duration - log.currentTime > 15) {
                  initialTime = log.currentTime;
                }
              }
            }
          } catch {}
        }

        const externalPool = Array.from(new Map(valid.map((stream) => [stream.url, stream] as const)).values());
        let externalPoolIndex = 0;
        const failedExternalSources = new Set<string>();
        let externalRecoveryCycles = 0;
        const maxExternalRecoveryCycles = 2;

        const refreshExternalSources = async () => {
          if (externalRecoveryCycles >= maxExternalRecoveryCycles || isStale()) return false;
          externalRecoveryCycles += 1;
          setLoading(true);
          setError(null);
          setStatus(`Refreshing stream sources (attempt ${externalRecoveryCycles}/${maxExternalRecoveryCycles})...`);
          await waitForRetry(10000 * externalRecoveryCycles, requestController.signal);
          if (isStale()) return false;
          try {
            const freshResponse = await fetchWithRetry(
              `${TMDB_EMBED_API}/api/streams/${streamPath}`,
              { signal: requestController.signal, cache: "no-store" },
              { attempts: 2, label: "fresh external streams" }
            );
            if (!freshResponse.ok) return false;
            const freshData = await freshResponse.json();
            if (isStale()) return false;
            const rawStreams = Array.isArray(freshData?.streams)
              ? freshData.streams
              : Array.isArray(freshData?.results) ? freshData.results : [];
            const additions = rawStreams
              .map((stream: any) => ({ url: String(stream?.url || ""), name: String(stream?.name || stream?.provider || selectedProvider) }))
              .filter((stream: { url: string }) => stream.url && !failedExternalSources.has(stream.url) &&
                !externalPool.some((existing) => existing.url === stream.url));
            externalPool.push(...additions);
            return additions.length > 0;
          } catch (error) {
            console.warn("[watch] Fresh external stream resolution failed", error);
            return false;
          }
        };

        setEpisodeTitle((prev) =>
          prev && prev !== "Currently Loading..."
            ? prev
            : (isExternalMovie ? "Full Feature Film" : `Episode ${epNum}`)
        );

        if (!persistentHit) {
          const bestStream = valid[0] && valid[0].url ? valid[0] : valid.find((s: any) => s.url);
          if (bestStream) {
            persistentCache[persistentCacheKey] = {
              url: bestStream.url,
              name: bestStream.name || selectedProvider,
              transactionId: transaction.id,
              healthy: false,
              cachedAt: Date.now(),
            };
            savePersistentSourceCache(persistentCache);

            const pref = loadProviderPref();
            if (pref[mediaTypeKey] !== selectedProvider) {
              pref[mediaTypeKey] = selectedProvider;
              saveProviderPref(pref);
            }
          }
        }

        let externalRecoveryPromise: Promise<void> | null = null;
        let externalExhaustionLogged = false;
        const advanceExternalPlayback = async (): Promise<void> => {
          if (isStale()) return;
          if (externalPoolIndex < externalPool.length) {
            const currentStream = externalPool[externalPoolIndex];
            externalPoolIndex++;
            setStatus(`[Link ${externalPoolIndex}/${externalPool.length}] Launching: ${currentStream.name}...`);
            await bindMediaSource(currentStream.url, currentStream.name);
          } else {
            const video = videoRef.current;
            const mediaStillActive = !!video && !video.paused && (playbackHasStartedRef.current || video.readyState >= 2);
            if (mediaStillActive) {
              setError(null);
              setStatus("Playback ready");
              return;
            }
            if (await refreshExternalSources()) {
              return advanceExternalPlayback();
            }
            if (externalExhaustionLogged) return;
            externalExhaustionLogged = true;
            console.error("[watch] All external playback sources exhausted", {
              provider: selectedProvider,
              route: `${anilistId}:${seasonNum}:${epNum}`,
              failedSources: failedExternalSources.size,
              recoveryCycles: externalRecoveryCycles,
            });
            setError("Automatic recovery could not find a working source. Choose another provider or try again in a moment.");
            setLoading(false);
          }
        };
        const tryPlayNext = (): Promise<void> => {
          if (externalRecoveryPromise) return externalRecoveryPromise;
          externalRecoveryPromise = advanceExternalPlayback().finally(() => {
            externalRecoveryPromise = null;
          });
          return externalRecoveryPromise;
        };

        const bindMediaSource = async (targetUrl: string, sourceProvider = selectedProvider) => {
          let sourceSettled = false;
          destroyHls();
          if (isStale() || !videoRef.current) return;

          const attemptId = ++sourceAttemptRef.current;
          sourceStateRef.current = "pending";
          activeSourceUrlRef.current = targetUrl;
          const ownsAttempt = () =>
            !isStale() && sourceAttemptRef.current === attemptId && activeSourceUrlRef.current === targetUrl;

          const failCurrentSource = () => {
            const video = videoRef.current;
            const mediaActive = !!video && !video.paused && (playbackHasStartedRef.current || video.readyState >= 2);
            if (sourceSettled || !ownsAttempt() || (sourceStateRef.current === "healthy" && mediaActive)) return;
            sourceSettled = true;
            sourceStateRef.current = "failed";
            failedExternalSources.add(targetUrl);
            if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
            invalidateFailedSource(targetUrl);
            markProviderFailure(sourceProvider);
            tryPlayNext();
          };
          mediaFailureHandlerRef.current = failCurrentSource;
          mediaSuccessHandlerRef.current = () => {
            if (!ownsAttempt()) return;
            sourceStateRef.current = "healthy";
            if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
          };
          mediaProgressHandlerRef.current = () => {
            if (!ownsAttempt()) return;
            markSourceHealthy(targetUrl);
            clearProviderFailure(sourceProvider);
          };
          let nativeStartupReloaded = false;
          streamTimeoutRef.current = setTimeout(() => {
            if (!ownsAttempt() || sourceStateRef.current === "healthy") return;
            const video = videoRef.current;
            if (!nativeStartupReloaded && isAppleMobileDevice() && video?.readyState === 0 && targetUrl.includes(".m3u8")) {
              nativeStartupReloaded = true;
              console.warn("[watch] Native HLS startup delayed; reloading source once", { provider: sourceProvider, url: targetUrl });
              try { video.load(); } catch {}
              streamTimeoutRef.current = setTimeout(() => {
                if (!ownsAttempt() || sourceStateRef.current === "healthy") return;
                failCurrentSource();
              }, STREAM_LOAD_TIMEOUT_MS);
              return;
            }
            console.warn("[watch] Stream load timeout; attempting backup link", { provider: sourceProvider, url: targetUrl });
            failCurrentSource();
          }, STREAM_LOAD_TIMEOUT_MS);

          const isHlsStream = targetUrl.includes('.m3u8') || targetUrl.includes('playlist') || targetUrl.includes('vixsrc');

          if (isHlsStream) {
            const nativeHlsSupported = !!videoRef.current?.canPlayType("application/vnd.apple.mpegurl");
            const preferNativeHls = nativeHlsSupported && isAppleMobileDevice();
            console.info("[watch] binding playback source", {
              transaction: transaction.id,
              provider: sourceProvider,
              engine: preferNativeHls ? "native" : "hls.js",
              nativeHlsSupported,
            });
            const { default: Hls } = await import("hls.js");
            if (isStale() || !videoRef.current) return;

            if (!preferNativeHls && Hls.isSupported()) {
              const hls = new Hls({
                enableWorker: true,
                maxBufferLength: 30,
                maxMaxBufferLength: 60,
                maxBufferSize: 60 * 1024 * 1024,
                backBufferLength: 30,
                capLevelToPlayerSize: true,
                lowLatencyMode: false,
                manifestLoadingMaxRetry: 3,
                manifestLoadingRetryDelay: 1000,
                manifestLoadingTimeOut: 30000,
                levelLoadingMaxRetry: 3,
                levelLoadingRetryDelay: 1000,
                levelLoadingTimeOut: 30000,
                fragLoadingMaxRetry: 4,
                fragLoadingRetryDelay: 1000,
                fragLoadingTimeOut: 20000,
              });
              hlsRef.current = hls;

              const extendStreamTimeout = (ms: number = STREAM_LOAD_TIMEOUT_EXTENDED_MS) => {
                if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
                streamTimeoutRef.current = setTimeout(() => {
                  if (!ownsAttempt() || sourceStateRef.current === "healthy") return;
                  console.warn("[watch] Extended stream load timeout; attempting backup link", { provider: sourceProvider, url: targetUrl });
                  failCurrentSource();
                }, ms);
              };

              hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (cancelled || !ownsAttempt()) return;
                extendStreamTimeout(STREAM_LOAD_TIMEOUT_EXTENDED_MS);
                setLoading(false);
                setStatus("Playback ready");
                console.info("[watch] first external manifest parsed", {
                  provider: sourceProvider,
                  ms: Date.now() - pipelineStartedAt,
                });
                const levels = Array.isArray(hls.levels) ? hls.levels : [];
                if (levels.length > 0) {
                  const capIdx = cappedLevelIndexFor(levels, TARGET_MAX_HEIGHT);
                  const startIdx = bestStartupLevelIndex(levels);
                  hls.autoLevelCapping = capIdx >= 0 ? capIdx : -1;
                  if (levels.length > 1 && startIdx >= 0) {
                    hls.currentLevel = startIdx;
                  }
                  const shownHeight =
                    Number(levels[levels.length > 1 ? Math.max(startIdx, 0) : 0]?.height) ||
                    Number(videoRef.current?.videoHeight) || 0;
                  if (shownHeight > 0) setVideoQuality(`${shownHeight}p`);
                  hls.on(Hls.Events.LEVEL_SWITCHED, (_evt: unknown, data: { level?: number }) => {
                    const level = hls.levels?.[data?.level ?? -1];
                    if (!cancelled && !isStale() && Number(level?.height) > 0) {
                      setVideoQuality(`${level.height}p`);
                    }
                  });
                }
                if (initialTime > 0) videoRef.current!.currentTime = initialTime;
                if (autoplay) videoRef.current?.play().catch(() => {
                  if (!isStale()) { setLoading(false); setStatus("Ready — tap Play"); }
                });
                const trackElements = videoRef.current?.querySelectorAll('track');
                trackElements?.forEach(track => {
                  track.addEventListener('error', () => {
                    console.warn('[watch] Subtitle track error (non-fatal)', { src: track.src });
                  });
                });
              });

              hls.on(Hls.Events.LEVEL_LOADED, () => {
                if (cancelled || !ownsAttempt()) return;
                extendStreamTimeout(STREAM_LOAD_TIMEOUT_EXTENDED_MS);
              });

              hls.on(Hls.Events.ERROR, (event: any, errData: any) => {
                if (errData.fatal && ownsAttempt()) {
                  if (sourceSettled) return;
                  console.warn("[watch] Fatal HLS failure; trying next source", {
                    provider: sourceProvider,
                    type: errData.type,
                    details: errData.details,
                    url: targetUrl,
                  });
                  if (hlsRef.current === hls) hlsRef.current = null;
                  hls.destroy();
                  failCurrentSource();
                }
              });

              hls.loadSource(targetUrl);
              hls.attachMedia(videoRef.current);
            } else if (nativeHlsSupported) {
              videoRef.current.src = targetUrl;
              videoRef.current.addEventListener("loadedmetadata", () => {
                if (cancelled || !ownsAttempt()) return;
                setLoading(false);
                setStatus("Playback ready");
                if (initialTime > 0) videoRef.current!.currentTime = initialTime;
                if (autoplay) videoRef.current?.play().catch(() => {
                  if (!isStale()) { setLoading(false); setStatus("Ready — tap Play"); }
                });
              }, { once: true });

              const onNativeQualityChange = () => {
                if (cancelled || !ownsAttempt()) return;
                const v = videoRef.current;
                if (v?.videoHeight) setVideoQuality(`${v.videoHeight}p`);
              };
              videoRef.current.addEventListener("resize", onNativeQualityChange);

              const onNativeProgress = () => {
                if (cancelled || !ownsAttempt()) return;
                if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
                mediaSuccessHandlerRef.current?.();
                mediaProgressHandlerRef.current?.();
              };
              videoRef.current.addEventListener("playing", onNativeProgress, { once: true });
              videoRef.current.onerror = () => {
                failCurrentSource();
                console.warn("Direct source link failed, trying next option...");
              };
              videoRef.current.load();
            } else {
              if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
              tryPlayNext();
            }
          } else {
            videoRef.current.src = targetUrl;
            videoRef.current.onloadedmetadata = () => {
              if (cancelled || !ownsAttempt()) return;
              if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
              setLoading(false);
              setStatus("Playback ready");
              console.info("[watch] first external playable media", {
                provider: sourceProvider,
                ms: Date.now() - pipelineStartedAt,
              });
              if (initialTime > 0) videoRef.current!.currentTime = initialTime;
              if (autoplay) videoRef.current?.play().catch(() => {
                if (!isStale()) { setLoading(false); setStatus("Ready — tap Play"); }
              });
            };
            videoRef.current.onerror = () => {
              failCurrentSource();
              console.warn("Direct source link failed, trying next option...");
            };
            videoRef.current.load();
          }
        };

        tryPlayNext();
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? "Failed to load stream for this title.");
          setLoading(false);
        }
      }
    }

    runExternal();
    return () => {
      cancelled = true;
      requestController.abort();
    };
  }, [
    isExternalMedia,
    isExternalMovie,
    anilistId,
    seasonNum,
    epNum,
    destroyHls,
    autoplay,
    mediaType,
    provider,
    pathname,
    router,
    queryString,
    routeIdentity,
    activeRouteIdentityRef,
    playbackGenerationRef,
    sourceAttemptRef,
    sourceStateRef,
    activeSourceUrlRef,
    playbackHasStartedRef,
    playbackSourceReadyRef,
    mediaFailureHandlerRef,
    mediaSuccessHandlerRef,
    mediaProgressHandlerRef,
    streamTimeoutRef,
    stallRecoveryTimerRef,
    savedTimeRef,
    forceStartFromZeroRef,
    videoRef,
    hlsRef,
    setLoading,
    setError,
    setStatus,
    setExternalStreamUrl,
    setAvailableProviders,
    setEpisodeTitle,
    setVideoQuality,
    resetSkipState,
  ]);
}
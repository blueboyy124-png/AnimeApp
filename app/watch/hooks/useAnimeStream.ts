import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  STABILITY_PRIORITY,
  TARGET_MAX_HEIGHT,
  STREAM_LOAD_TIMEOUT_MS,
  STREAM_LOAD_TIMEOUT_EXTENDED_MS,
  FAST_PROBE_TIMEOUT_MS,
  FAST_PROBE_ATTEMPTS,
  PERSISTENT_SOURCE_CACHE_TTL_MS,
  SOURCE_CACHE_TTL_MS,
} from "../lib/constants";
import {
  isAppleMobileDevice,
  proxySubtitleUrl,
  waitForRetry,
  fetchWithRetry,
  runWithConcurrency,
  proxiedStreamUrl,
  extractHlsCandidates,
  collectDirectHlsStreams,
  validateHlsCandidate,
  probeAndPickStream,
  extractEpisodeLists,
  candListHasEpisode,
} from "../lib/utils";
import {
  loadSourceCache,
  saveSourceCache,
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
import { getResumeTimeKey } from "../lib/history";
import { fetchAnimeInfo } from "../lib/animeApi";
import { cappedLevelIndexFor, bestStartupLevelIndex } from "../lib/hlsLevels";
import { getApiBaseUrl } from "../../utils/api";
import type { EpisodeNode } from "../lib/types";

const BACKEND_API = getApiBaseUrl();

interface UseAnimeStreamOptions {
  isExternalMedia: boolean;
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
  episodesCacheRef: React.MutableRefObject<{ id: string; data: any } | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hlsRef: React.MutableRefObject<any>;
  destroyHls: () => void;
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setStatus: (v: string) => void;
  setAvailableProviders: (providers: string[]) => void;
  setEpisodes: (episodes: EpisodeNode[]) => void;
  setSubSlug: (slug: string | null) => void;
  setDubSlug: (slug: string | null) => void;
  setHasDubAvailable: (has: boolean) => void;
  setEpisodeSnapshot: (snap: string) => void;
  setEpisodeTitle: (title: string) => void;
  setEpisodeDesc: (desc: string) => void;
  setAnimeTitle: (title: string) => void;
  setSubtitleTracks: (tracks: any[]) => void;
  setVideoQuality: (q: string) => void;
  resetSkipState: () => void;
  autoplay: boolean;
  captionsEnabled: boolean;
  pathname: string;
  router: ReturnType<typeof useRouter>;
  queryString: string;
}

export function useAnimeStream({
  isExternalMedia,
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
  episodesCacheRef,
  videoRef,
  hlsRef,
  destroyHls,
  setLoading,
  setError,
  setStatus,
  setAvailableProviders,
  setEpisodes,
  setSubSlug,
  setDubSlug,
  setHasDubAvailable,
  setEpisodeSnapshot,
  setEpisodeTitle,
  setEpisodeDesc,
  setAnimeTitle,
  setSubtitleTracks,
  setVideoQuality,
  resetSkipState,
  autoplay,
  captionsEnabled,
  pathname,
  router,
  queryString,
}: UseAnimeStreamOptions) {
  useEffect(() => {
    if (isExternalMedia) return;

    const id = parseInt(anilistId, 10);
    const epFloat = parseFloat(epNum);
    if (!id || isNaN(id)) return;

    let cancelled = false;
    const requestController = new AbortController();
    const generation = playbackGenerationRef.current;
    const transaction = {
      id: `${routeIdentity}:${generation}`,
      mediaFamily: "anime" as const,
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

    async function runAnime() {
      try {
        const pipelineStartedAt = Date.now();
        if (isStale()) return;
        setLoading(true);
        setError(null);
        resetSkipState();

        let epData: any;
        if (episodesCacheRef.current?.id === anilistId) {
          epData = episodesCacheRef.current.data;
        } else {
          const res = await fetchWithRetry(
            `${BACKEND_API}/episodes/${id}`,
            { signal: requestController.signal },
            { attempts: 3, label: "episode metadata" }
          );
          if (res.ok) {
            epData = await res.json();
            episodesCacheRef.current = { id: anilistId, data: epData };
          }
        }

        if (isStale()) return;
        if (epData) {
          console.info("[watch] anime metadata ready", { ms: Date.now() - pipelineStartedAt, id, episode: epNum });
          const providerGroup = epData?.results?.providers || epData?.providers || {};
          const discovered = Object.keys(providerGroup).filter(
            (k) => k !== "subtitles" && k !== "banners"
          );
          if (!cancelled) setAvailableProviders(discovered);

          // DISPLAY provider: some providers (e.g. bonk) carry wrong or
          // incomplete episode numbering for long series like One Piece even
          // though playback resolves fine by episode number. Show the grid,
          // titles and descriptions from the first provider (in priority
          // order) whose list actually contains the requested episode.
          let displayProvider = provider;
          const displayCandidates = Array.from(new Set([
            provider,
            ...STABILITY_PRIORITY,
            ...Object.keys(providerGroup),
          ].filter(Boolean)));
          for (const cand of displayCandidates) {
            const { subList: candSub, dubList: candDub } = extractEpisodeLists(epData, cand);
            const candList = activeCategory === "dub" ? candDub : candSub;
            if (candListHasEpisode(candList, epFloat)) { displayProvider = cand; break; }
          }
          const { subList, dubList } = extractEpisodeLists(epData, displayProvider);
          const activeList = activeCategory === "dub" ? dubList : subList;
          const sorted = [...activeList].sort((a, b) => a.number - b.number);
          if (!cancelled) setEpisodes(sorted);

          const subNode = subList.find((e) => Number(e.number) === epFloat);
          const dubNode = dubList.find((e) => Number(e.number) === epFloat);

          if (!cancelled) {
            setSubSlug(subNode ? subNode.slug ?? subNode.id : null);
            setDubSlug(dubNode ? dubNode.slug ?? dubNode.id : null);
            setHasDubAvailable(dubList.length > 0);

            const matchedNode = activeList.find((e) => Number(e.number) === epFloat);
            if (matchedNode) {
              if (matchedNode.image) setEpisodeSnapshot(matchedNode.image);
              setEpisodeTitle(matchedNode.title || `Episode ${matchedNode.number}`);
              setEpisodeDesc(matchedNode.description || "");
            }
          }

          // Title metadata is cosmetic for playback. Resolve it in parallel so
          // a slow `/info` request never blocks the first stream.
          void fetchAnimeInfo(id)
            .then((infoData) => {
              const showTitle =
                infoData?.results?.title?.english  ??
                infoData?.results?.title?.romaji   ??
                infoData?.title?.english           ??
                infoData?.title?.romaji;
              if (showTitle && !isStale()) setAnimeTitle(showTitle);
            })
            .catch(() => {});
        }

        let targetStreamUrl = "";
        let targetStreamDirect = false; // true → CDN allows CORS; play the URL directly without the proxy
        let targetReferer   = "https://kwik.cx/";
        let selectedProvider = provider;
        let targetSubtitles: any[] = [];

        // Check persistent (7-day) cache first for instant replay across sessions.
        const persistentCacheKey = `anime:${mediaType}:${anilistId}:${seasonNum || "1"}:${epNum}:${activeCategory}:${currentSlug || "-"}`;
        const persistentCache = loadPersistentSourceCache();
        const persistentHit =
          persistentCache[persistentCacheKey] &&
          (!persistentCache[persistentCacheKey].transactionId || persistentCache[persistentCacheKey].transactionId === transaction.id) &&
          persistentCache[persistentCacheKey].healthy !== false &&
          Date.now() - (persistentCache[persistentCacheKey].cachedAt || 0) < PERSISTENT_SOURCE_CACHE_TTL_MS;

        const sourceCacheKey = `${provider}:${mediaType}:${anilistId}:${seasonNum || "1"}:${epNum}:${activeCategory}:${currentSlug || "-"}`;
        const sourceCache = loadSourceCache();
        const cachedSource = sourceCache[sourceCacheKey];
        const sourceCacheHit =
          cachedSource &&
          (!cachedSource.transactionId || cachedSource.transactionId === transaction.id) &&
          cachedSource.healthy !== false && Date.now() - (cachedSource.cachedAt || 0) < SOURCE_CACHE_TTL_MS;

        if (persistentHit) {
          targetStreamUrl = persistentCache[persistentCacheKey].streamUrl;
          targetReferer = persistentCache[persistentCacheKey].referer || targetReferer;
          selectedProvider = persistentCache[persistentCacheKey].selectedProvider || provider;
          targetSubtitles = persistentCache[persistentCacheKey].subtitles || [];
        } else if (sourceCacheHit) {
          targetStreamUrl = cachedSource.streamUrl;
          targetReferer = cachedSource.referer;
          selectedProvider = cachedSource.selectedProvider;
          targetSubtitles = cachedSource.subtitles || [];
        }

        // Validate a cache hit before committing to it.
        if (targetStreamUrl) {
          const cachedMode = await validateHlsCandidate(
            { url: targetStreamUrl, referer: targetReferer },
            targetReferer,
            requestController.signal,
            2
          );
          if (isStale()) return;
          if (!cachedMode) {
            console.info("[watch] Cached source invalid — resolving fresh", { provider: selectedProvider });
            targetStreamUrl = "";
            targetStreamDirect = false;
            targetSubtitles = [];
          } else {
            targetStreamDirect = cachedMode === "direct";
          }
        }

        // Provider preference for anime
        const providerPref = loadProviderPref();
        const manualPref = typeof window !== "undefined" ? localStorage.getItem("streamanime_pref_provider") : null;
        const typePref = providerPref.anime;
        const orderedPrefs = Array.from(new Set([
          "bonk",
          provider,
          manualPref || "",
          typePref || "",
          ...STABILITY_PRIORITY,
          ...(epData ? Object.keys(epData?.results?.providers || epData?.providers || {}) : []),
        ].filter(Boolean)));

        const healthyPrefs = orderedPrefs.filter((name) => name === provider || !isProviderSuppressed(name));
        const fallbackQueue = healthyPrefs.length > 0 ? healthyPrefs : orderedPrefs;
        const backupStreams: { url: string; referer: string; provider: string; subtitles: any[]; direct?: boolean }[] = [];
        const resolvedProviderNames = new Set<string>(persistentHit || sourceCacheHit ? [selectedProvider] : []);

        const resolveProviderStream = async (provKey: string) => {
          const { subList, dubList } = extractEpisodeLists(epData, provKey);
          const list = activeCategory === "dub" ? dubList : subList;
          const match = list.find((e) => Number(e.number) === epFloat);
          if (!match) return null;
          const slug = match.id.includes("/") ? match.id.split("/").pop() ?? match.id : match.id;
          const watchRes = await fetchWithRetry(
            `${BACKEND_API}/watch/${provKey}/${id}/${activeCategory}/${encodeURIComponent(slug)}`,
            { signal: requestController.signal },
            { attempts: provKey === provider ? 3 : 2, label: `provider ${provKey}` }
          );
          if (!watchRes.ok) throw new Error(`${watchRes.status}`);
          const data = await watchRes.json();
          const subs = data?.results?.subtitles ?? data?.subtitles ?? [];

          // FAST PATH
          const directCandidates = collectDirectHlsStreams(data, targetReferer);
          if (directCandidates.length > 0) {
            const [fastPicked] = await probeAndPickStream(
              directCandidates.slice(0, 1),
              targetReferer,
              requestController.signal,
              1,
              FAST_PROBE_ATTEMPTS,
              FAST_PROBE_TIMEOUT_MS
            );
            if (fastPicked) {
              console.info("[watch] fast-path stream resolved", { provider: provKey, ms: Date.now() - pipelineStartedAt });
              return {
                url: fastPicked.url,
                referer: fastPicked.referer || targetReferer,
                subtitles: Array.isArray(subs) ? subs : [],
                direct: fastPicked.mode === "direct",
              };
            }
            console.warn("[watch] fast-path probe failed — falling back to deep validation", { provider: provKey });
          }

          // FALLBACK
          const candidates = extractHlsCandidates(data);
          const [picked] = await probeAndPickStream(candidates, targetReferer, requestController.signal, 1);
          if (!picked) return null;
          return {
            url: picked.url,
            referer: picked.referer || targetReferer,
            subtitles: Array.isArray(subs) ? subs : [],
            direct: picked.mode === "direct",
          };
        };

        for (const provKey of fallbackQueue.slice(0, 1)) {
          if (cancelled) return;
          resolvedProviderNames.add(provKey);
          try {
            if (!cancelled) setStatus(`Routing via [${provKey.toUpperCase()}]...`);
            const resolved = targetStreamUrl
              ? { url: targetStreamUrl, referer: targetReferer, subtitles: targetSubtitles, direct: false }
              : await resolveProviderStream(provKey);
            if (resolved && !targetStreamUrl) {
              targetStreamUrl = resolved.url;
              targetReferer = resolved.referer;
              targetStreamDirect = resolved.direct === true;
              selectedProvider = provKey;
              targetSubtitles = resolved.subtitles;
              console.info("[watch] primary stream resolved", { provider: selectedProvider, ms: Date.now() - pipelineStartedAt });
            }
          } catch {
            markProviderFailure(provKey);
            console.warn(`[watch] Provider [${provKey}] failed, trying next...`);
          }
        }

        if (!targetStreamUrl) {
          const fallbackResults: Array<{ provider: string; url: string; referer: string; subtitles: any[]; direct?: boolean }> = [];
          await runWithConcurrency(fallbackQueue.slice(1), 3, async (provKey) => {
            resolvedProviderNames.add(provKey);
            try {
              const resolved = await resolveProviderStream(provKey);
              if (resolved) fallbackResults.push({ provider: provKey, ...resolved });
            } catch {
              markProviderFailure(provKey);
              console.warn(`[watch] Provider [${provKey}] failed during concurrent fallback`);
            }
          });
          const firstFallback = fallbackResults[0];
          if (firstFallback) {
            targetStreamUrl = firstFallback.url;
            targetReferer = firstFallback.referer;
            targetStreamDirect = firstFallback.direct === true;
            selectedProvider = firstFallback.provider;
            targetSubtitles = firstFallback.subtitles;
            backupStreams.push(...fallbackResults.slice(1));
          }
        }

        if (!targetStreamUrl) {
          throw new Error("All providers are temporarily unavailable. Automatic retries are exhausted; choose another source to continue.");
        }
        if (isStale()) return;

        if (!sourceCacheHit) {
          sourceCache[sourceCacheKey] = {
            streamUrl: targetStreamUrl,
            referer: targetReferer,
            selectedProvider,
            transactionId: transaction.id,
            subtitles: targetSubtitles,
            healthy: false,
            cachedAt: Date.now(),
          };
          saveSourceCache(sourceCache);

          persistentCache[persistentCacheKey] = {
            streamUrl: targetStreamUrl,
            referer: targetReferer,
            selectedProvider,
            transactionId: transaction.id,
            subtitles: targetSubtitles,
            healthy: false,
            cachedAt: Date.now(),
          };
          savePersistentSourceCache(persistentCache);
        }

        const pref = loadProviderPref();
        if (pref.anime !== selectedProvider) {
          pref.anime = selectedProvider;
          saveProviderPref(pref);
        }

        if (selectedProvider !== provider) {
          const p = new URLSearchParams(queryString);
          p.set("provider", selectedProvider);
          router.replace(`${pathname}?${p.toString()}`);
        }

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
                  String(item.episodeNumber) === String(epNum)
              );
              if (log && log.currentTime > 5) {
                if (!log.duration || log.duration - log.currentTime > 15) {
                  initialTime = log.currentTime;
                }
              }
            }
          } catch {}
          if (initialTime === 0) {
            try {
              const savedResumeTime = localStorage.getItem(getResumeTimeKey(anilistId, epNum));
              if (savedResumeTime) {
                const parsed = parseFloat(savedResumeTime);
                if (parsed > 5) {
                  initialTime = parsed;
                  localStorage.removeItem(getResumeTimeKey(anilistId, epNum));
                }
              }
            } catch {}
          }
        }

        const proxyUrl = targetStreamDirect
          ? targetStreamUrl
          : `/api/stream-proxy` +
            `?url=${encodeURIComponent(targetStreamUrl)}` +
            `&referer=${encodeURIComponent(targetReferer)}`;

        setSubtitleTracks(
          targetSubtitles
            .filter((s: any) => s?.url)
            .map((s: any) => ({
              url: proxySubtitleUrl(String(s.url), targetReferer),
              label: s.label || s.language || "Subtitles",
              language: s.language || s.lang || "en",
              isDefault: !!s.isDefault || !!s.default,
            }))
            .filter((s) => s.url)
        );

        const animePool = Array.from(new Map([
          { url: proxyUrl, name: selectedProvider },
          ...backupStreams.map((b) => ({
            url: b.direct
              ? b.url
              : `/api/stream-proxy?url=${encodeURIComponent(b.url)}&referer=${encodeURIComponent(b.referer)}`,
            name: b.provider,
          })),
        ].map((stream) => [stream.url, stream] as const)).values());
        let animePoolIndex = 0;
        const failedAnimeSources = new Set<string>();
        let animeRecoveryCycles = 0;
        const maxAnimeRecoveryCycles = 2;

        const refreshAnimeSources = async () => {
          if (animeRecoveryCycles >= maxAnimeRecoveryCycles || isStale()) return false;
          animeRecoveryCycles += 1;
          setLoading(true);
          setError(null);
          setStatus(`Refreshing stream sources (attempt ${animeRecoveryCycles}/${maxAnimeRecoveryCycles})...`);
          await waitForRetry((animeRecoveryCycles === 1 ? 5000 : 10000) * animeRecoveryCycles, requestController.signal);
          if (isStale()) return false;

          const freshStreams: Array<{ url: string; referer: string; provider: string; direct?: boolean }> = [];
          await runWithConcurrency(fallbackQueue, 3, async (provKey) => {
            if (isStale()) return;
            try {
              const resolved = await resolveProviderStream(provKey);
              if (!resolved || failedAnimeSources.has(resolved.url)) return;
              freshStreams.push({ url: resolved.url, referer: resolved.referer, provider: provKey, direct: resolved.direct === true });
            } catch (error) {
              console.warn("[watch] Fresh anime provider resolution failed", { provider: provKey, error });
            }
          });

          const additions = freshStreams
            .map((stream) => ({
              url: stream.direct
                ? stream.url
                : `/api/stream-proxy?url=${encodeURIComponent(stream.url)}&referer=${encodeURIComponent(stream.referer)}`,
              name: stream.provider,
            }))
            .filter((stream) => !failedAnimeSources.has(stream.url) &&
              !animePool.some((existing) => existing.url === stream.url));
          if (isStale()) return false;
          animePool.push(...additions);
          return additions.length > 0;
        };

        let animeRecoveryPromise: Promise<void> | null = null;
        let animeExhaustionLogged = false;
        const advanceAnimePlayback = async (): Promise<void> => {
          if (isStale()) return;
          if (animePoolIndex < animePool.length) {
            const currentStream = animePool[animePoolIndex];
            animePoolIndex++;
            await bindMediaSource(currentStream.url, currentStream.name);
          } else {
            if (!backupsFinished) {
              await backupsPromise;
              if (isStale()) return;
              if (animePoolIndex < animePool.length) {
                return advanceAnimePlayback();
              }
            }
            const video = videoRef.current;
            const mediaStillActive = !!video && !video.paused && (playbackHasStartedRef.current || video.readyState >= 2);
            if (mediaStillActive) {
              setError(null);
              setStatus("Playback ready");
              return;
            }
            if (await refreshAnimeSources()) {
              return advanceAnimePlayback();
            }
            if (animeExhaustionLogged) return;
            animeExhaustionLogged = true;
            console.error("[watch] All anime playback sources exhausted", {
              provider: selectedProvider,
              route: `${anilistId}:${seasonNum}:${epNum}:${activeCategory}`,
              failedSources: failedAnimeSources.size,
              recoveryCycles: animeRecoveryCycles,
            });
            setError("Automatic recovery could not find a working source. Choose another provider or try again in a moment.");
            setLoading(false);
          }
        };
        const tryPlayNext = (): Promise<void> => {
          if (animeRecoveryPromise) return animeRecoveryPromise;
          animeRecoveryPromise = advanceAnimePlayback().finally(() => {
            animeRecoveryPromise = null;
          });
          return animeRecoveryPromise;
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
            failedAnimeSources.add(targetUrl);
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
                fragLoadingMaxRetry: 6,
                fragLoadingRetryDelay: 1000,
                fragLoadingTimeOut: 20000,
              });
              hlsRef.current = hls;

              let mediaRecoveryAttempts = 0;
              let networkRecoveryAttempts = 0;
              hls.on(Hls.Events.FRAG_BUFFERED, () => {
                mediaRecoveryAttempts = 0;
                networkRecoveryAttempts = 0;
              });

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
                console.info("[watch] first manifest parsed", {
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
                videoRef.current!.currentTime = initialTime;
                if (autoplay) videoRef.current?.play().catch(() => {
                  if (!isStale()) { setLoading(false); setStatus("Ready — tap Play"); }
                });
                const textTracks = videoRef.current?.textTracks;
                if (textTracks) {
                  for (let i = 0; i < textTracks.length; i++) {
                    textTracks[i].mode = captionsEnabled ? "showing" : "hidden";
                  }
                }
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
                if (!errData?.fatal || !ownsAttempt()) return;
                if (sourceSettled) return;
                if (errData.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 2) {
                  mediaRecoveryAttempts += 1;
                  console.warn("[watch] Recovering HLS media error in place", {
                    attempt: mediaRecoveryAttempts,
                    details: errData.details,
                    provider: sourceProvider,
                  });
                  if (mediaRecoveryAttempts >= 2) { try { hls.swapAudioCodec(); } catch {} }
                  try { hls.recoverMediaError(); } catch {}
                  return;
                }
                if (errData.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveryAttempts < 3) {
                  networkRecoveryAttempts += 1;
                  console.warn("[watch] Recovering HLS network error in place", {
                    attempt: networkRecoveryAttempts,
                    details: errData.details,
                    provider: sourceProvider,
                  });
                  extendStreamTimeout(STREAM_LOAD_TIMEOUT_EXTENDED_MS);
                  try { hls.startLoad(); } catch {}
                  return;
                }
                console.warn("[watch] Fatal HLS failure; trying next source", {
                  provider: sourceProvider,
                  type: errData.type,
                  details: errData.details,
                  url: targetUrl,
                });
                if (hlsRef.current === hls) hlsRef.current = null;
                hls.destroy();
                failCurrentSource();
              });

              hls.loadSource(targetUrl);
              hls.attachMedia(videoRef.current);
            } else if (nativeHlsSupported) {
              videoRef.current.src = targetUrl;
              videoRef.current.addEventListener("loadedmetadata", () => {
                if (cancelled || !ownsAttempt()) return;
                setLoading(false);
                setStatus("Playback ready");
                videoRef.current!.currentTime = initialTime;
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
              };
              videoRef.current.load();
            } else {
              if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
              setError("Browser does not support HLS playback.");
            }
          } else {
            videoRef.current.src = targetUrl;
            videoRef.current.onloadedmetadata = () => {
              if (cancelled || !ownsAttempt()) return;
              if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
              setLoading(false);
              setStatus("Playback ready");
              console.info("[watch] first playable media", {
                provider: selectedProvider,
                ms: Date.now() - pipelineStartedAt,
              });
              videoRef.current!.currentTime = initialTime;
              if (autoplay) videoRef.current?.play().catch(() => {
                if (!isStale()) { setLoading(false); setStatus("Ready — tap Play"); }
              });
            };
            videoRef.current.onerror = () => {
              failCurrentSource();
            };
            videoRef.current.load();
          }
        };

        let backupsFinished = false;
        let backupsPromise: Promise<void>;
        backupsPromise = (async () => {
          try {
            await runWithConcurrency(
              fallbackQueue.filter((provKey) => !resolvedProviderNames.has(provKey)),
              3,
              async (provKey) => {
                if (cancelled) return;

                const { subList, dubList } = extractEpisodeLists(epData, provKey);
                const list = activeCategory === "dub" ? dubList : subList;
                const match = list.find((e) => Number(e.number) === epFloat);
                if (!match) return;
                const slug = match.id.includes("/") ? match.id.split("/").pop() ?? match.id : match.id;

                try {
                  const watchRes = await fetchWithRetry(
                    `${BACKEND_API}/watch/${provKey}/${id}/${activeCategory}/${encodeURIComponent(slug)}`,
                    { signal: requestController.signal },
                    { attempts: 2, label: `backup provider ${provKey}` }
                  );
                  if (!watchRes.ok) return;
                  const data = await watchRes.json();
                  const candidates = extractHlsCandidates(data);
                  const pickedList = await probeAndPickStream(candidates, targetReferer, requestController.signal, 2);
                  if (isStale()) return;
                  for (const picked of pickedList) {
                    const backupUrl = picked.mode === "direct"
                      ? picked.url
                      : proxiedStreamUrl(picked.url, picked.referer || targetReferer);
                    if (!animePool.some((stream) => stream.url === backupUrl)) {
                      animePool.push({ url: backupUrl, name: provKey });
                    }
                  }
                  if (pickedList.length === 0) {
                    markProviderFailure(provKey);
                    console.warn(`[watch] Backup provider [${provKey}] failed (no valid HLS streams)`);
                  }
                } catch {
                  markProviderFailure(provKey);
                  console.warn(`[watch] Backup provider [${provKey}] failed`);
                }
              }
            );
          } finally {
            backupsFinished = true;
          }
        })();

        setTimeout(() => {
          if (!cancelled) tryPlayNext();
        }, 500);

      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? "Pipeline linking failed.");
          setLoading(false);
        }
      }
    }

    runAnime();
    return () => {
      cancelled = true;
      requestController.abort();
    };
  }, [
    provider,
    anilistId,
    activeCategory,
    currentSlug,
    epNum,
    destroyHls,
    pathname,
    router,
    queryString,
    autoplay,
    captionsEnabled,
    isExternalMedia,
    mediaType,
    seasonNum,
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
    episodesCacheRef,
    videoRef,
    hlsRef,
    setLoading,
    setError,
    setStatus,
    setAvailableProviders,
    setEpisodes,
    setSubSlug,
    setDubSlug,
    setHasDubAvailable,
    setEpisodeSnapshot,
    setEpisodeTitle,
    setEpisodeDesc,
    setAnimeTitle,
    setSubtitleTracks,
    setVideoQuality,
    resetSkipState,
  ]);
}
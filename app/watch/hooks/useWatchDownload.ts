import { useState, useEffect, useCallback } from "react";
import { saveOfflineDownload, makeDownloadId, isEpisodeDownloaded } from "../../utils/offlineStore";
import { getApiBaseUrl } from "../../utils/api";

const BACKEND_API = getApiBaseUrl();

interface UseWatchDownloadOptions {
  anilistId: string;
  epNum: string;
  seasonNum: string;
  currentSlug: string;
  animeTitle: string;
  episodeSnapshot: string;
  activeCategory: string;
  provider: string;
  isExternalMedia: boolean;
  isExternalMovie: boolean;
  setError: (msg: string | null) => void;
}

export function useWatchDownload({
  anilistId,
  epNum,
  seasonNum,
  currentSlug,
  animeTitle,
  episodeSnapshot,
  activeCategory,
  provider,
  isExternalMedia,
  isExternalMovie,
  setError,
}: UseWatchDownloadOptions) {
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadedFlag, setDownloadedFlag] = useState(false);

  // Movies have no episode number — always use "1" as their download key so
  // the Downloads page and the saved-flag check agree.
  const downloadEpisodeKey = isExternalMovie ? "1" : epNum;

  useEffect(() => {
    let activeId: string | null = null;
    try { activeId = localStorage.getItem("streamanime_active_profile_id"); } catch { activeId = null; }
    if (!activeId || !anilistId) return;
    isEpisodeDownloaded(activeId, anilistId, downloadEpisodeKey).then(setDownloadedFlag);
  }, [anilistId, downloadEpisodeKey]);

  const handleDownload = useCallback(async () => {
    if (!anilistId || downloadProgress !== null) return;
    if (!isExternalMedia && !currentSlug) return;

    const activeId = localStorage.getItem("streamanime_active_profile_id");
    if (!activeId) {
      alert("You need an active profile to save downloads.");
      return;
    }

    const mediaTypeForDownload = isExternalMedia
      ? (isExternalMovie ? "movie" : "tv")
      : "anime";

    setError(null);
    setDownloadProgress(0);
    try {
      // Build the backend URL per media type.
      const params = new URLSearchParams();
      params.set("mediaType", mediaTypeForDownload);
      if (isExternalMedia) {
        const tmdbId = anilistId.replace(/^tmdb-(?:movie|tv)-/i, "");
        params.set("tmdbId", tmdbId);
        if (!isExternalMovie) {
          params.set("season", seasonNum);
          params.set("episode", epNum);
        }
        if (provider) params.set("provider", provider);
      } else {
        params.set("provider", provider);
        params.set("anilistId", anilistId);
        params.set("category", activeCategory);
        params.set("slug", currentSlug);
      }
      const url = `${BACKEND_API}/download?${params.toString()}`;

      const safeTitle = (animeTitle || "media").replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60).trim();
      const filename = `${safeTitle || "media"}${isExternalMovie ? "" : ` - E${downloadEpisodeKey}`}.mp4`;

      // Electron desktop app: download straight to the OS Downloads folder via
      // the main process (no in-memory Blob, no IndexedDB size limits).
      const electronApi = (window as any).electronAPI;
      if (electronApi?.downloadMedia) {
        setDownloadProgress(-1);
        const timeoutMs = 5 * 60 * 1000; // 5 minutes
        const downloadPromise = electronApi.downloadMedia({ url, filename });
        const timeoutPromise = new Promise((_, reject) => {
          const id = window.setTimeout(() => {
            reject(new Error("Download timed out after 5 minutes."));
          }, timeoutMs);
          downloadPromise.finally(() => window.clearTimeout(id));
        });

        const result = await Promise.race([downloadPromise, timeoutPromise]);
        if (!result?.ok) throw new Error(result?.error || "Download failed");

        await saveOfflineDownload({
          id: makeDownloadId(activeId, anilistId, downloadEpisodeKey),
          profileId: activeId,
          mediaId: String(anilistId),
          mediaType: mediaTypeForDownload,
          animeTitle,
          episodeNumber: String(downloadEpisodeKey),
          episodeImage: episodeSnapshot || "",
          category: activeCategory,
          season: isExternalMedia && !isExternalMovie ? String(seasonNum) : undefined,
          filePath: result.filePath,
          sizeBytes: result.sizeBytes || 0,
          downloadedAt: Date.now(),
        });

        setDownloadProgress(100);
        setDownloadedFlag(true);
        window.setTimeout(() => setDownloadProgress(null), 1200);
        return;
      }

      // Browser/website fallback: stream to an in-memory Blob + IndexedDB.
      const controller = new AbortController();
      const stallTimeoutMs = 60_000;
      let stallTimer = window.setTimeout(() => controller.abort(), stallTimeoutMs);

      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || !res.body) {
        const message = res.statusText || `HTTP ${res.status}`;
        throw new Error(`Download request failed: ${message}`);
      }

      const contentLength = Number(res.headers.get("content-length")) || 0;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      setDownloadProgress(contentLength ? 0 : -1);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          window.clearTimeout(stallTimer);
          stallTimer = window.setTimeout(() => controller.abort(), stallTimeoutMs);
          chunks.push(value);
          received += value.length;
          if (contentLength) setDownloadProgress(Math.min(99, Math.round((received / contentLength) * 100)));
        }
      }

      window.clearTimeout(stallTimer);

      const blob = new Blob(chunks as BlobPart[], { type: "video/mp4" });

      if (blob.size === 0) {
        throw new Error("Received an empty file from the server.");
      }

      await saveOfflineDownload({
        id: makeDownloadId(activeId, anilistId, downloadEpisodeKey),
        profileId: activeId,
        mediaId: String(anilistId),
        mediaType: mediaTypeForDownload,
        animeTitle,
        episodeNumber: String(downloadEpisodeKey),
        episodeImage: episodeSnapshot || "",
        category: activeCategory,
        season: isExternalMedia && !isExternalMovie ? String(seasonNum) : undefined,
        blob,
        sizeBytes: blob.size,
        downloadedAt: Date.now(),
      });

      setDownloadProgress(100);
      setDownloadedFlag(true);
      window.setTimeout(() => setDownloadProgress(null), 1200);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("Offline download failed:", errorMessage);
      setError(`Download failed: ${errorMessage}`);
      setDownloadProgress(null);
    }
  }, [anilistId, downloadProgress, isExternalMedia, currentSlug, downloadEpisodeKey, setError, seasonNum, epNum, provider, activeCategory, animeTitle, isExternalMovie, episodeSnapshot]);

  return {
    downloadProgress,
    downloadedFlag,
    handleDownload,
    downloadEpisodeKey,
  };
}


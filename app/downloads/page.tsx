"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { supabase } from "../utils/supabase";
import {
  listOfflineDownloads,
  deleteOfflineDownload,
  OfflineDownload,
} from "../utils/offlineStore";

interface Profile {
  id: string;
  name: string;
  avatar_url: string;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function DownloadsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [downloads, setDownloads] = useState<OfflineDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowPlaying, setNowPlaying] = useState<OfflineDownload | null>(null);
  const [totalUsed, setTotalUsed] = useState(0);
  const objectUrlRef = useRef<string | null>(null);

  const loadEverything = useCallback(async () => {
    const activeId = localStorage.getItem("streamanime_active_profile_id");
    if (!activeId) {
      setLoading(false);
      return;
    }

    const { data } = await supabase.from("profiles").select("id, name, avatar_url").eq("id", activeId).maybeSingle();
    if (data) setProfile(data);

    const items = await listOfflineDownloads(activeId);
    items.sort((a, b) => b.downloadedAt - a.downloadedAt);
    setDownloads(items);
    setTotalUsed(items.reduce((sum, i) => sum + i.sizeBytes, 0));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEverything();
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [loadEverything]);

  const labelForItem = (item: OfflineDownload) => {
    if (item.mediaType === "movie") return item.animeTitle || "Movie";
    if (item.mediaType === "tv") return `${item.animeTitle || "TV Show"} — S${item.season ?? 1} E${item.episodeNumber}`;
    return `${item.animeTitle || "Anime"} — Ep ${item.episodeNumber}`;
  };

  const handlePlay = (item: OfflineDownload) => {
    // Electron: play straight from the saved file on disk using the native
    // custom protocol handler registered by the main process.
    const electronApi = (window as any).electronAPI;
    if (electronApi?.playMediaFile && item.filePath) {
      electronApi.playMediaFile(item.filePath).catch((err: any) => {
        console.error("Failed to play local file:", err);
        alert("Could not play this file. It may have been moved or deleted.");
      });
      return;
    }
    // Browser: play the in-memory blob (web-only downloads).
    if (!item.blob) {
      alert("This download has no local file to play.");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(item.blob);
    setNowPlaying(item);
  };

  const handleClosePlayer = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setNowPlaying(null);
  };

  const handleDelete = async (item: OfflineDownload) => {
    const isMovie = item.mediaType === "movie";
    if (!confirm(`Remove "${labelForItem(item)}" from your downloads?`)) return;
    // Also delete the file on disk when running in Electron.
    const electronApi = (window as any).electronAPI;
    if (electronApi?.deleteMediaFile && item.filePath) {
      try {
        await electronApi.deleteMediaFile(item.filePath);
      } catch (err) {
        console.warn("Could not delete file on disk:", err);
      }
    }
    await deleteOfflineDownload(item.id);
    setDownloads((prev) => prev.filter((d) => d.id !== item.id));
    setTotalUsed((prev) => prev - item.sizeBytes);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased pb-20 px-4 sm:px-6 md:px-12 pt-24">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/" className="text-2xl font-black tracking-tighter text-orange-500 hover:opacity-90 transition">
            STREAMANIME
          </Link>
          <h1 className="text-sm md:text-lg font-bold uppercase tracking-widest text-neutral-200 mt-4">
            Downloads {profile ? `— ${profile.name}` : ""}
          </h1>
          {downloads.length > 0 && (
            <p className="text-[11px] font-mono text-neutral-500 mt-1">
              {downloads.length} episode{downloads.length === 1 ? "" : "s"} saved &middot; {formatSize(totalUsed)} used on this device
            </p>
          )}
        </div>
        <Link
          href="/"
          className="text-xs font-mono uppercase tracking-widest text-neutral-500 hover:text-neutral-200 border border-neutral-800 hover:border-neutral-600 rounded px-4 py-2 transition cursor-pointer"
        >
          &larr; Home
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-orange-500 border-t-transparent" />
        </div>
      ) : downloads.length === 0 ? (
        <p className="text-sm text-neutral-500 font-mono">
          Nothing downloaded yet — hit "Download" on any episode's player page and it'll show up here, saved on
          this device for offline playback.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {downloads.map((item) => (
            <div
              key={item.id}
              className="bg-neutral-900/30 border border-neutral-900 rounded overflow-hidden hover:border-neutral-700 transition flex flex-col"
            >
              <button onClick={() => handlePlay(item)} className="relative aspect-video w-full bg-neutral-950 overflow-hidden group cursor-pointer">
                {item.episodeImage ? (
                  <img src={item.episodeImage} alt={item.animeTitle} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-700 text-3xl">▶</div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
                  <span className="opacity-0 group-hover:opacity-100 transition text-3xl">▶</span>
                </div>
              </button>
              <div className="p-3 flex flex-col flex-1 space-y-2">
                <div>
                  <h4 className="text-sm font-semibold text-neutral-200 line-clamp-1">{item.animeTitle}</h4>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">
                    Episode {item.episodeNumber} &middot; {item.category} &middot; {formatSize(item.sizeBytes)}
                  </p>
                </div>
                <div className="mt-auto flex gap-2">
                  <button
                    onClick={() => handlePlay(item)}
                    className="flex-1 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-xs font-mono font-bold uppercase tracking-widest transition active:scale-95 cursor-pointer"
                  >
                    Play
                  </button>
                  <button
                    onClick={() => handleDelete(item)}
                    title="Delete download"
                    className="px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800 hover:border-red-900 hover:text-red-400 text-xs font-mono uppercase tracking-widest transition active:scale-95 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {nowPlaying && objectUrlRef.current && (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center px-4" onClick={handleClosePlayer}>
          <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-neutral-200">
                {nowPlaying.animeTitle} &middot; Episode {nowPlaying.episodeNumber}
              </p>
              <button
                onClick={handleClosePlayer}
                className="text-xs font-mono uppercase tracking-widest text-neutral-500 hover:text-neutral-200 transition cursor-pointer"
              >
                ✕ Close
              </button>
            </div>
            <video
              src={objectUrlRef.current}
              controls
              autoPlay
              className="w-full aspect-video bg-black rounded"
            />
          </div>
        </div>
      )}
    </main>
  );
}
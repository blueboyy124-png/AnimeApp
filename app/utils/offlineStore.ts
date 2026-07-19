/*
 * offlineStore.ts
 *
 * Netflix-style "download inside the app" instead of dumping a file into
 * the OS Downloads folder. The video is fetched into memory as a Blob and
 * stored in IndexedDB, keyed per profile — the Downloads page lists these
 * and plays them straight from local storage, no network required once
 * they're saved.
 *
 * Trade-off worth knowing: without a service worker intercepting Range
 * requests, the whole file has to be held in memory while downloading
 * before it becomes a Blob. Fine for typical episode sizes on a phone or
 * laptop; a very large file on a very low-memory device could struggle.
 */

const DB_NAME = "streamanime_offline";
const DB_VERSION = 1;
const STORE_NAME = "downloads";

export interface OfflineDownload {
  id: string; // `${profileId}:${anilistId}:${episodeNumber}`
  profileId: string;
  anilistId: string;
  animeTitle: string;
  episodeNumber: string;
  episodeImage: string;
  category: string;
  blob: Blob;
  sizeBytes: number;
  downloadedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("profileId", "profileId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function makeDownloadId(profileId: string, anilistId: string | number, episodeNumber: string | number): string {
  return `${profileId}:${anilistId}:${episodeNumber}`;
}

export async function saveOfflineDownload(item: OfflineDownload): Promise<void> {
  // Best-effort request for persistent storage so the browser is less
  // likely to evict this under storage pressure. Not guaranteed, and
  // silently no-ops on browsers that don't support it.
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // non-fatal
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listOfflineDownloads(profileId: string): Promise<OfflineDownload[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("profileId");
    const req = index.getAll(profileId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflineDownload(id: string): Promise<OfflineDownload | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOfflineDownload(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function isEpisodeDownloaded(profileId: string, anilistId: string | number, episodeNumber: string | number): Promise<boolean> {
  const item = await getOfflineDownload(makeDownloadId(profileId, anilistId, episodeNumber));
  return !!item;
}
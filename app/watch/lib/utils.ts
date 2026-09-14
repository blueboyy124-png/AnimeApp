import { TMDB_API_KEY, RETRYABLE_STATUS_CODES, HLS_AD_HOST_PATTERN, STARTUP_MAX_HEIGHT, TARGET_MAX_HEIGHT } from "./constants";

// ---- Device & URL utilities ----

export function isAppleMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function proxySubtitleUrl(rawUrl: string, referer: string): string {
  if (!rawUrl) return "";
  if (rawUrl.startsWith("/api/stream-proxy")) return rawUrl;
  let sourceUrl = rawUrl;
  let sourceReferer = referer;
  if (rawUrl.startsWith("/api/proxy")) {
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      sourceUrl = parsed.searchParams.get("url") || "";
      sourceReferer = parsed.searchParams.get("referer") || referer;
    } catch {
      return "";
    }
  }
  if (!sourceUrl) return "";
  return `/api/stream-proxy?url=${encodeURIComponent(sourceUrl)}&referer=${encodeURIComponent(sourceReferer)}`;
}

// ---- Quality scoring ----

export function getQualityScore(label: string, height: number): number {
  const clean = (label || "").toLowerCase();
  let score = height || 0;
  if (clean.includes("1080")) score = 1080;
  else if (clean.includes("720")) score = 720;
  else if (clean.includes("480")) score = 480;
  else if (clean.includes("360")) score = 360;
  if (clean.includes("av1")) score += 15;
  else if (clean.includes("h.265") || clean.includes("265")) score += 10;
  else if (clean.includes("h.264") || clean.includes("264")) score += 5;
  return score;
}

// ---- TMDB API ----

export async function tmdbFetch(path: string): Promise<{ ok: boolean; data: any }> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_API_KEY}&language=en-US`);
  const data = await res.json();
  return { ok: res.ok, data };
}

// ---- Time formatting ----

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatTimeWithBounds(current: number, duration: number, delta: number): string {
  const target = Math.max(0, Math.min(current + delta, duration || Infinity));
  return formatTime(target);
}

// ---- Stream validation & retry logic ----

export function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("The operation was aborted", "AbortError")); return; }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("The operation was aborted", "AbortError"));
    }, { once: true });
  });
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { attempts?: number; label?: string; timeout?: number; retryOn500?: boolean } = {}
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = options.timeout ?? 20000;
  const retryOn500 = options.retryOn500 !== undefined ? options.retryOn500 : true;
  let lastError: unknown;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptController = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; attemptController.abort(); }, timeoutMs);
    const abortParent = () => attemptController.abort();
    init.signal?.addEventListener("abort", abortParent, { once: true });
    try {
      const response = await fetch(input, { ...init, signal: attemptController.signal });
      lastStatus = response.status;
      const isRetryable500 = retryOn500 && response.status >= 500 && response.status < 600;
      if (response.ok || (!RETRYABLE_STATUS_CODES.has(response.status) && !isRetryable500) || attempt >= attempts) return response;
      try { await response.body?.cancel(); } catch {}
      console.warn(`[watch] ${options.label || "request"} retry ${attempt}/${attempts - 1}`, { status: response.status });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || (!timedOut && error instanceof DOMException && error.name === "AbortError")) throw error;
      console.warn(`[watch] ${options.label || "request"} network retry ${attempt}/${attempts - 1}`);
    } finally {
      window.clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abortParent);
    }
    let backoffMs: number;
    if (lastStatus === 429 || lastStatus === 403) {
      backoffMs = 8000 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 1000);
    } else if (lastStatus >= 500 && lastStatus < 600) {
      backoffMs = 2000 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
    } else {
      backoffMs = 400 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 180);
    }
    await waitForRetry(backoffMs, init.signal || undefined);
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed after retries");
}

export async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
}

/** Validates that a stream URL is well-formed and likely to be playable. */
export function isValidStreamUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  if (url.includes("googleusercontent.com") && url.includes("AccessSignature")) {
    return false;
  }
  if (url.includes("exp=")) {
    try {
      const expMatch = url.match(/exp=(\d+)/);
      if (expMatch) {
        const expTime = parseInt(expMatch[1], 10);
        if (expTime > 1000000000 && expTime < Date.now() / 1000) return false;
        if (expTime > 1000000000000 && expTime < Date.now()) return false;
      }
    } catch {}
  }
  return true;
}

/** Probes a stream URL with a HEAD request. */
export async function probeStreamUrl(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export function proxiedStreamUrl(url: string, referer: string): string {
  return `/api/stream-proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer)}`;
}

export function extractHlsCandidates(data: any): { url: string; referer: string }[] {
  const candidates: { url: string; referer: string }[] = [];
  const seen = new Set<string>();
  const push = (stream: any) => {
    const url = typeof stream?.url === "string" ? stream.url : "";
    if (!url || seen.has(url)) return;
    if (!isValidStreamUrl(url)) return;
    if (stream?.type && stream.type !== "hls") return;
    if (!url.includes(".m3u8")) return;
    seen.add(url);
    candidates.push({ url, referer: typeof stream?.referer === "string" ? stream.referer : "" });
  };
  push(data?.results?.bestStream ?? data?.bestStream);
  const streams = (data?.results?.streams ?? data?.streams ?? []) as any[];
  const hlsStreams = streams.filter((s) => s?.type === "hls" && typeof s?.url === "string" && s.url.includes(".m3u8"));
  hlsStreams.sort((a, b) => (a.url.includes("master.m3u8") ? 0 : 1) - (b.url.includes("master.m3u8") ? 0 : 1));
  hlsStreams.forEach(push);
  return candidates;
}

export function collectDirectHlsStreams(data: any, refererFallback: string) {
  const candidates: Array<{ url: string; referer: string }> = [];
  const seen = new Set<string>();
  const push = (stream: any) => {
    const url = typeof stream?.url === "string" ? stream.url : "";
    if (!url || seen.has(url)) return;
    if (!isValidStreamUrl(url)) return;
    if (!/\.m3u8(\?|#|$)/i.test(url)) return;
    if (/embed|player|iframe|videostream|streamwish|filemoon|vidmoly/i.test(url)) return;
    seen.add(url);
    candidates.push({ url, referer: typeof stream?.referer === "string" ? stream.referer : refererFallback });
  };
  push(data?.results?.bestStream ?? data?.bestStream);
  const streams = (data?.results?.streams ?? data?.streams ?? []) as any[];
  if (Array.isArray(streams)) {
    const ordered = [...streams].sort((a, b) =>
      (String(a?.url || "").includes("master.m3u8") ? 0 : 1) -
      (String(b?.url || "").includes("master.m3u8") ? 0 : 1)
    );
    ordered.forEach(push);
  }
  return candidates;
}

export function manifestHasRealSegments(body: string): boolean {
  const segmentLines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (segmentLines.length === 0) return false;
  return segmentLines.some((line) => !HLS_AD_HOST_PATTERN.test(line));
}

export async function checkManifestAndVariants(
  body: string,
  candidate: { url: string; referer: string },
  refererFallback: string,
  mode: "direct" | "proxy",
  signal?: AbortSignal,
  probeTimeoutMs = 8000
): Promise<boolean> {
  if (!body.startsWith("#EXTM3U")) return false;
  if (!body.includes("#EXT-X-STREAM-INF")) return manifestHasRealSegments(body);
  const variantLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (!variantLine) return false;
  const alreadyProxied = variantLine.startsWith("/api/stream-proxy?url=");
  let variantUrl = variantLine;
  if (!alreadyProxied) {
    try { variantUrl = new URL(variantLine, candidate.url).toString(); } catch { return false; }
  }
  const fetchManifest = async (url: string): Promise<{ ok: boolean; text: string }> => {
    if (alreadyProxied) {
      const res = await fetchWithRetry(
        new URL(url, window.location.origin).toString(),
        { signal },
        { attempts: 2, label: "hls probe variant", timeout: probeTimeoutMs }
      );
      return { ok: res.ok, text: res.ok ? await res.text().catch(() => "") : "" };
    }
    if (mode === "direct") {
      const res = await fetch(url, { signal });
      return { ok: res.ok, text: res.ok ? await res.text().catch(() => "") : "" };
    }
    const res = await fetchWithRetry(
      proxiedStreamUrl(url, candidate.referer || refererFallback),
      { signal },
      { attempts: 2, label: "hls probe variant", timeout: probeTimeoutMs }
    );
    return { ok: res.ok, text: res.ok ? await res.text().catch(() => "") : "" };
  };
  const variant = await fetchManifest(variantUrl);
  if (!variant.ok) return false;
  return variant.text.startsWith("#EXTM3U") && manifestHasRealSegments(variant.text);
}

export async function validateHlsCandidate(
  candidate: { url: string; referer: string },
  refererFallback: string,
  signal?: AbortSignal,
  maxAttempts = 3,
  probeTimeoutMs = 8000
): Promise<"direct" | "proxy" | null> {
  if (!signal?.aborted) {
    try {
      const direct = await fetch(candidate.url, { signal });
      if (direct.ok) {
        const body = await direct.text().catch(() => "");
        if (await checkManifestAndVariants(body, candidate, refererFallback, "direct", signal, probeTimeoutMs)) {
          return "direct";
        }
      } else {
        try { await direct.body?.cancel(); } catch {}
      }
    } catch {
      // CORS blocked or network error
    }
  }
  const res = await fetchWithRetry(
    proxiedStreamUrl(candidate.url, candidate.referer || refererFallback),
    { signal },
    { attempts: maxAttempts, label: "hls probe", timeout: probeTimeoutMs }
  );
  if (!res.ok) return null;
  const body = await res.text().catch(() => "");
  return (await checkManifestAndVariants(body, candidate, refererFallback, "proxy", signal, probeTimeoutMs)) ? "proxy" : null;
}

export async function probeAndPickStream(
  candidates: Array<{ url: string; referer: string }>,
  refererFallback: string,
  signal?: AbortSignal,
  maxValidated = 1,
  probeAttempts = 3,
  probeTimeoutMs = 8000
) {
  const validated: Array<{ url: string; referer: string; mode: "direct" | "proxy" }> = [];
  for (const candidate of candidates.slice(0, 4)) {
    if (signal?.aborted) break;
    const mode = await validateHlsCandidate(candidate, refererFallback, signal, probeAttempts, probeTimeoutMs);
    if (mode) {
      validated.push({ ...candidate, mode });
      if (validated.length >= maxValidated) break;
    } else {
      console.info("[watch] HLS candidate rejected (invalid, ad-only, or rate-limited)", {
        url: candidate.url.slice(0, 90),
      });
    }
  }
  return validated;
}

// ---- Episode & history utilities ----

export function extractEpisodeLists(epData: any, provider: string) {
  const block =
    epData?.results?.providers?.[provider] ??
    epData?.providers?.[provider]          ??
    epData?.results?.[provider]            ??
    epData?.[provider];

  if (!block) return { subList: [] as any[], dubList: [] as any[] };

  const root = block?.episodes ?? block ?? {};
  return {
    subList: (root.sub ?? root.SUB ?? []) as any[],
    dubList: (root.dub ?? root.DUB ?? []) as any[],
  };
}

export function candListHasEpisode(list: any[], epFloat: number): boolean {
  return list.some((e) => {
    const parsed = Number(String(e?.number ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) && parsed === epFloat;
  });
}

export function normalizeHistoryTitleKey(title?: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function dedupeHistoryEntriesByTitle(entries: any[]): any[] {
  const byKey = new Map<string, any>();
  const order: string[] = [];

  for (const entry of entries) {
    if (!entry) continue;
    const key = normalizeHistoryTitleKey(entry.animeTitle) || String(entry.anilistId ?? "");
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, entry);
    } else if ((entry.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      byKey.set(key, entry);
    }
  }

  return order.map((key) => byKey.get(key));
}

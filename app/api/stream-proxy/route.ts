// app/api/stream-proxy/route.ts
import { NextRequest, NextResponse } from "next/server";

const FETCH_TIMEOUT_MS = 60_000; // 4K FIX: Increased from 20s to 60s for large 4K/2K segments

function buildUpstreamHeaders(request: NextRequest, referer: string, isManifestUrl = false): Headers {
  let refererOrigin = referer;
  try { refererOrigin = new URL(referer).origin; } catch {}

  // Always present a desktop Chrome UA to upstream providers. Forwarding the
  // client UA (e.g. iPad Safari) makes many anime CDNs serve a different,
  // mobile-incompatible HLS manifest or block the request outright, which is
  // why streams that play on a laptop stall on iOS/iPadOS. The proxy is the
  // one place that should normalise the UA so every device gets byte-identical
  // HLS content.
  const h = new Headers({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer":         referer,
    "Origin":          refererOrigin,
    "Accept":          request.headers.get("accept") || "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest":  "empty",
    "Sec-Fetch-Mode":  "cors",
    "Sec-Fetch-Site":  "cross-site",
    "Connection":      "keep-alive",
  });

  // Safari's native HLS preflights manifest requests with a tiny
  // `Range: bytes=0-1`. Forwarding that makes upstream return a 2-byte 206
  // partial which then fails the manifest rewrite below ("0 playable
  // segments") and 502s — which is exactly why playback worked on Chrome
  // (hls.js never ranges manifests) but failed on iPad Safari. Manifests are
  // small; always fetch them in full.
  const range = request.headers.get("range");
  if (range && !isManifestUrl) h.set("Range", range);
  return h;
}

function isManifest(url: string, contentType: string): boolean {
  return (
    url.includes(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("x-mpegurl") ||
    contentType.includes("vnd.apple.mpegurl")
  );
}

function isKeyFile(url: string, contentType: string): boolean {
  const looksLikeSegment =
    url.includes(".ts")   ||
    url.includes(".m4s")  ||
    url.includes(".mp4")  ||
    url.includes(".xls")  ||
    url.includes(".jpg")  ||
    url.includes(".jpeg") ||
    url.includes("segment");

  return (
    url.includes("/key")     ||
    url.includes("/enc.key") ||
    url.includes("/aes128")  ||
    (contentType.includes("octet-stream") && !looksLikeSegment)
  );
}

function sniffMediaType(bytes: Uint8Array): "video/mp2t" | "video/mp4" | null {
  if (bytes.length >= 8) {
    const boxType = new TextDecoder().decode(bytes.subarray(4, 8));
    if (boxType === "ftyp" || boxType === "moof" || boxType === "styp") return "video/mp4";
  }
  // MPEG-TS packets are 188 bytes and begin with a 0x47 sync byte. Checking
  // a second packet avoids misclassifying arbitrary binary data by chance.
  if (bytes.length >= 376 && bytes[0] === 0x47 && bytes[188] === 0x47) return "video/mp2t";
  if (bytes.length >= 1 && bytes[0] === 0x47) return "video/mp2t";
  return null;
}

function prependChunk(first: Uint8Array<ArrayBufferLike>, body: ReadableStream<Uint8Array<ArrayBufferLike>>): ReadableStream<Uint8Array<ArrayBufferLike>> {
  const reader = body.getReader();
  let sent = false;
  return new ReadableStream<Uint8Array<ArrayBufferLike>>({
    async pull(controller) {
      if (!sent) { sent = true; controller.enqueue(first); return; }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel(reason) { try { await reader.cancel(reason); } catch {} },
  });
}

function toAbsolute(segment: string, origin: string, base: string): string {
  if (segment.startsWith("http://") || segment.startsWith("https://")) return segment;
  if (segment.startsWith("//")) return `https:${segment}`;
  if (segment.startsWith("/")) return `${origin}${segment}`;
  return `${base}${segment}`;
}

// Detects ad segments that some anime/movie providers (e.g. vivibebe)
// inject straight into their HLS playlists. These ads come from ByteDance
// ad CDNs (ibyteimg.com etc.) — their URLs are only fetchable by the ad
// provider's own JS, so proxying them 403s and makes HLS.js retry-hammer
// the same failing fragment until playback stutters/freezes. We strip
// them out of the rewritten manifest entirely and insert a discontinuity
// marker so the player hops cleanly past the ad.
function isAdSegmentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (
      host.endsWith("ibyteimg.com") ||
      host.endsWith("byteimg.com") ||
      host.endsWith("bytecdn.cn") ||
      host.includes("bytedance")
    ) return true;
    if (
      path.includes("/ad-site-i18n/") ||
      path.includes("/advert") ||
      path.includes("/ad/") ||
      (path.includes("-ads-") && u.searchParams.has("token"))
    ) return true;
  } catch {
    // Not a parseable URL — leave it alone
  }
  return false;
}

function normaliseCodecs(codecs: string): string {
  return codecs
    .split(",")
    .map((c) => c.trim())
    .map((c) => (c === "mp4a.40.1" ? "mp4a.40.2" : c))
    .filter(Boolean)
    .join(",");
}

function rewriteManifest(
  text: string,
  targetUrl: URL,
  proxySelf: string,
  referer: string
): { text: string; segmentCount: number } {
  const base   = targetUrl.href.substring(0, targetUrl.href.lastIndexOf("/") + 1);
  const origin = targetUrl.origin;

  const isFmp4 = 
    text.includes("#EXT-X-MAP") || 
    targetUrl.href.includes("vivibebe.site") || 
    targetUrl.href.includes("public/stream");

  const lines  = text.split("\n");
  const output: string[] = [];
  let segmentCount = 0;

  // Tracks the #EXTINF one line ahead of its segment URI so the ad filter can
  // drop both together (a standalone #EXTINF with no following segment would
  // otherwise corrupt the playlist).
  let pendingExtinf: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { output.push(raw); continue; }

    // CRITICAL FIX: Ensure #EXTM3U remains line 1 to prevent levelParsingErrors
    if (line.startsWith("#EXTM3U")) {
      output.push(line);
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      pendingExtinf = line;
      continue;
    }

    if (line.startsWith("#EXT-X-KEY")) {
      // Guard against a bogus bare #EXTINF before a KEY line
      if (pendingExtinf) { output.push(pendingExtinf); pendingExtinf = null; }
      output.push(
        line.replace(/URI=(["']?)([^"'\s,]+)\1/, (_m, _q, uri: string) => {
          const abs = toAbsolute(uri, origin, base);
          return `URI="${proxySelf}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}"`;
        })
      );
      continue;
    }

    if (line.startsWith("#EXT-X-MAP")) {
      if (pendingExtinf) { output.push(pendingExtinf); pendingExtinf = null; }
      output.push(
        line.replace(/URI=(["']?)([^"'\s,]+)\1/, (_m, _q, uri: string) => {
          const abs = toAbsolute(uri, origin, base);
          return `URI="${proxySelf}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}&fmt=mp4"`;
        })
      );
      continue;
    }

    // URI-bearing tags such as EXT-X-MEDIA and I-FRAME-STREAM-INF are easy to
    // miss and otherwise make Safari request the upstream URL directly. Keep
    // all attributes intact while routing only their URI through this proxy.
    if (line.startsWith("#") && /\bURI=/i.test(line)) {
      if (pendingExtinf) { output.push(pendingExtinf); pendingExtinf = null; }
      output.push(line.replace(/URI=(['"]?)([^'"\s,]+)\1/i, (_m, _q, uri: string) => {
        const abs = toAbsolute(uri, origin, base);
        return `URI="${proxySelf}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}"`;
      }));
      continue;
    }

    if (line.startsWith("#EXT-X-STREAM-INF")) {
      if (pendingExtinf) { output.push(pendingExtinf); pendingExtinf = null; }
      if (line.includes("CODECS=")) {
        output.push(
          line.replace(/CODECS="([^"]+)"/, (_m, c: string) => `CODECS="${normaliseCodecs(c)}"`)
        );
      } else {
        // Don't inject a fixed CODECS — Safari's native HLS strictly matches
        // the declared codec against the actual segment bytes, and a wrong
        // guess (e.g. avc1.4d401f for an HEVC stream) makes Safari reject the
        // variant entirely. Both hls.js and Safari auto-detect codecs when
        // CODECS is absent, so leaving it off is safer than guessing.
        output.push(line);
      }
      continue;
    }

    if (line.startsWith("#")) {
      if (pendingExtinf) { output.push(pendingExtinf); pendingExtinf = null; }
      output.push(raw);
      continue;
    }

    // ── Segment URI ──────────────────────────────────────────────────
    const abs    = toAbsolute(line, origin, base);
    const fmtTag = isFmp4 ? "&fmt=mp4" : "&fmt=ts";

    if (isAdSegmentUrl(abs)) {
      // Drop the ad segment AND its #EXTINF. Flag that we just cut something
      // so the next real segment gets a discontinuity marker — lets HLS.js
      // jump the timeline gap instead of stalling on a missing fragment.
      pendingExtinf = null;
      if (
        output.length > 0 &&
        output[output.length - 1] !== "#EXT-X-DISCONTINUITY" &&
        // Don't prepend a discontinuity at the very start of a playlist —
        // there's nothing to join yet.
        !text.split("\n")[0].startsWith("#EXT-X-DISCONTINUITY")
      ) {
        output.push("#EXT-X-DISCONTINUITY");
      }
      continue;
    }

    if (pendingExtinf) {
      output.push(pendingExtinf);
      pendingExtinf = null;
    }
    segmentCount++;
    output.push(
      `${proxySelf}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}${fmtTag}`
    );
  }

  // Flush any trailing #EXTINF that had no segment after it.
  if (pendingExtinf) output.push(pendingExtinf);

  return { text: output.join("\n"), segmentCount };
}

function resolveMimeType(
  url: string,
  urlPath: string,
  upstreamContentType: string,
  fmtHint: string | null
): string {
  if (isKeyFile(url, upstreamContentType)) return "application/octet-stream";
  if (fmtHint === "mp4") return "video/mp4";
  if (fmtHint === "ts") return "video/mp2t";
  if (urlPath.endsWith(".xls")) return "video/mp2t";

  if (
    urlPath.endsWith(".m4s") ||
    urlPath.endsWith(".mp4") ||
    urlPath.includes("public/stream") ||
    upstreamContentType.includes("mp4")
  ) return "video/mp4";

  if (
    urlPath.endsWith(".ts") ||
    upstreamContentType.startsWith("image/")   ||
    (urlPath.endsWith(".jpg")  && urlPath.includes("segment")) ||
    (urlPath.endsWith(".jpeg") && urlPath.includes("segment"))
  ) return "video/mp2t";

  return upstreamContentType || "application/octet-stream";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const referer   = searchParams.get("referer") || "https://kwik.cx/";
  const fmtHint   = searchParams.get("fmt");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing parameter: url" }, { status: 400 });
  }

  let targetUrlObj: URL;
  try {
    targetUrlObj = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "Invalid target URL" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const isManifestUrl = targetUrl.toLowerCase().includes(".m3u8");
    const upstream = await fetch(targetUrl, {
      method:  "GET",
      headers: buildUpstreamHeaders(request, referer, isManifestUrl),
      signal:  controller.signal,
    });

    clearTimeout(timeout);

    const status      = upstream.status;
    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();

    if (status >= 400) {
      return NextResponse.json(
        { error: `Upstream error status response: ${status}` },
        { status }
      );
    }

    if (isManifest(targetUrl, contentType)) {
      const text = await upstream.text();
      const { text: rewritten, segmentCount } = rewriteManifest(
        text,
        targetUrlObj,
        request.nextUrl.pathname,
        referer
      );

      // FAIL FAST: Some providers (e.g. vivibebe/bonk) return playlists that
      // are 100% injected ads (ibyteimg.com etc.). After ad filtering the
      // playlist is valid HLS but has ZERO playable segments, which makes
      // hls.js silently stall until the 30-45s load timeout fires. Returning
      // an error status instead triggers hls.js's fatal levelLoadError path
      // so the frontend fails over to the next provider within seconds.
      // Only fail fast on a REAL manifest that is genuinely 100% ads. A body
      // that isn't a manifest (e.g. a truncated/error page) is returned as-is
      // so the client decides — otherwise a non-manifest body would be
      // mislabeled "ad-only" and kill a healthy stream.
      if (text.startsWith("#EXTM3U") && segmentCount === 0) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[stream-proxy] ${targetUrlObj.host} manifest has 0 playable segments after ad filtering — failing fast`);
        }
        return NextResponse.json(
          { error: "Manifest contains no playable segments (ad-only stream)" },
          { status: 502 }
        );
      }

      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "Content-Type":                "application/x-mpegURL; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "*",
          "Accept-Ranges":               "bytes",
          "Cache-Control":               "public, max-age=3, stale-while-revalidate=6",
        },
      });
    }

    if (!upstream.body) {
      return NextResponse.json({ error: "Empty upstream body" }, { status: 502 });
    }

    const urlPath  = targetUrlObj.pathname.toLowerCase();
    let body: ReadableStream<Uint8Array<ArrayBufferLike>> = upstream.body as ReadableStream<Uint8Array<ArrayBufferLike>>;
    let sniffedType: "video/mp2t" | "video/mp4" | null = null;
    const declaredType = resolveMimeType(targetUrl, urlPath, contentType, fmtHint);

    // Only inspect ambiguous binary responses. Manifests and keys are handled
    // above/by extension and are never buffered here.
    const shouldSniff =
      declaredType === "application/octet-stream" ||
      urlPath.endsWith(".xls") ||
      urlPath.includes("segment") ||
      urlPath.endsWith(".jpg") ||
      urlPath.endsWith(".jpeg");
    if (shouldSniff && body) {
      const reader = body.getReader();
      const first = await reader.read();
      if (!first.done && first.value) {
        sniffedType = sniffMediaType(first.value);
        body = prependChunk(first.value, new ReadableStream<Uint8Array<ArrayBufferLike>>({
          async pull(controller) {
            const next = await reader.read();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          },
          async cancel(reason) { try { await reader.cancel(reason); } catch {} },
        }));
      } else {
        body = new ReadableStream<Uint8Array<ArrayBufferLike>>({ start(controller) { controller.close(); } });
      }
    }

    const mimeType = sniffedType || declaredType;
    if (process.env.NODE_ENV !== "production") {
      console.info(`[stream-proxy] ${targetUrlObj.host} ${mimeType} (${sniffedType ? "sniffed" : "declared"})`);
    }

    const responseHeaders = new Headers({
      "Content-Type":                  mimeType,
      "Access-Control-Allow-Origin":   "*",
      "Access-Control-Expose-Headers": "*",
      "Cache-Control":                 "public, max-age=3600, immutable",
    });

    for (const h of ["content-length", "content-range", "accept-ranges", "etag"] as const) {
      const v = upstream.headers.get(h);
      if (v) responseHeaders.set(h, v);
    }

    return new NextResponse(body, {
      status,
      statusText: upstream.statusText,
      headers:    responseHeaders,
    });

  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Upstream timed out" }, { status: 504 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age":       "86400",
    },
  });
}

// app/api/stream-proxy/route.ts
import { NextRequest, NextResponse } from "next/server";

const FETCH_TIMEOUT_MS = 20_000;

function buildUpstreamHeaders(request: NextRequest, referer: string): Headers {
  let refererOrigin = referer;
  try { refererOrigin = new URL(referer).origin; } catch {}

  const h = new Headers({
    "User-Agent":
      request.headers.get("user-agent") ||
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

  const range = request.headers.get("range");
  if (range) h.set("Range", range);
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

function toAbsolute(segment: string, origin: string, base: string): string {
  if (segment.startsWith("http://") || segment.startsWith("https://")) return segment;
  if (segment.startsWith("//")) return `https:${segment}`;
  if (segment.startsWith("/")) return `${origin}${segment}`;
  return `${base}${segment}`;
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
): string {
  const base   = targetUrl.href.substring(0, targetUrl.href.lastIndexOf("/") + 1);
  const origin = targetUrl.origin;

  const isFmp4 = 
    text.includes("#EXT-X-MAP") || 
    targetUrl.href.includes("vivibebe.site") || 
    targetUrl.href.includes("public/stream");

  const lines  = text.split("\n");
  const output: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { output.push(raw); continue; }

    // CRITICAL FIX: Ensure #EXTM3U remains line 1 to prevent levelParsingErrors
    if (line.startsWith("#EXTM3U")) {
      output.push(line);
      continue;
    }

    if (line.startsWith("#EXT-X-KEY")) {
      output.push(
        line.replace(/URI=(["']?)([^"'\s,]+)\1/, (_m, _q, uri: string) => {
          const abs = toAbsolute(uri, origin, base);
          return `URI="${proxySelf}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}"`;
        })
      );
      continue;
    }

    if (line.startsWith("#EXT-X-MAP")) {
      output.push(
        line.replace(/URI=(["']?)([^"'\s,]+)\1/, (_m, _q, uri: string) => {
          const abs = toAbsolute(uri, origin, base);
          return `URI="${proxySelf}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}&fmt=mp4"`;
        })
      );
      continue;
    }

    if (line.startsWith("#EXT-X-STREAM-INF")) {
      if (line.includes("CODECS=")) {
        output.push(
          line.replace(/CODECS="([^"]+)"/, (_m, c: string) => `CODECS="${normaliseCodecs(c)}"`)
        );
      } else {
        output.push(`${line},CODECS="avc1.4d401f,mp4a.40.2"`);
      }
      continue;
    }

    if (line.startsWith("#")) { output.push(raw); continue; }

    const abs    = toAbsolute(line, origin, base);
    const fmtTag = isFmp4 ? "&fmt=mp4" : "";
    output.push(
      `${proxySelf}?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(referer)}${fmtTag}`
    );
  }

  return output.join("\n");
}

function resolveMimeType(
  url: string,
  urlPath: string,
  upstreamContentType: string,
  fmtHint: string | null
): string {
  if (isKeyFile(url, upstreamContentType)) return "application/octet-stream";
  if (fmtHint === "mp4") return "video/mp4";

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
    const upstream = await fetch(targetUrl, {
      method:  "GET",
      headers: buildUpstreamHeaders(request, referer),
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
      const text      = await upstream.text();
      const rewritten = rewriteManifest(text, targetUrlObj, request.nextUrl.pathname, referer);

      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "Content-Type":                "application/x-mpegURL; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control":               "public, max-age=3, stale-while-revalidate=6",
        },
      });
    }

    if (!upstream.body) {
      return NextResponse.json({ error: "Empty upstream body" }, { status: 502 });
    }

    const urlPath  = targetUrlObj.pathname.toLowerCase();
    const mimeType = resolveMimeType(targetUrl, urlPath, contentType, fmtHint);

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

    return new NextResponse(upstream.body, {
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
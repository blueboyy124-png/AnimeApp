// app/api/watch/[...slug]/route.ts
import { NextRequest, NextResponse } from "next/server";

// Import your custom Miruro API tunnel engine
// Adjust this import path relative to where your pipe.js file lives
const { getWatchSources } = require("@/lib/pipe"); 

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  try {
    // 1. Next.js catch-all routes supply parameters as an ordered array:
    // URL: /api/watch/[provider]/[anilistId]/[category]/[episodeSlug]
    // Array maps to: ["kiwi", "21", "sub", "animepahe-3-3"]
    const pathSegments = params.slug;

    if (!pathSegments || pathSegments.length < 4) {
      return NextResponse.json(
        { error: "Malformed watch request segments. Missing parameters." },
        { status: 400 }
      );
    }

    const provider  = pathSegments[0];
    const anilistId = parseInt(pathSegments[1], 10);
    const category  = pathSegments[2];
    const epSlug    = pathSegments[3];

    if (isNaN(anilistId)) {
      return NextResponse.json({ error: "Invalid AniList ID format" }, { status: 400 });
    }

    console.log(`[Watch Scraper] Resolving stream for provider: ${provider}, Anime: ${anilistId}, Episode: ${epSlug}`);

    // 2. Fetch tracking endpoints using your browser emulation pipeline inside pipe.js
    const sources = await getWatchSources(provider, anilistId, category, epSlug);

    if (!sources || !sources.streams) {
      return NextResponse.json({ error: "Upstream pipeline returned zero stream links." }, { status: 404 });
    }

    // 3. Return payload structure matching the exact syntax page.tsx expects:
    // page.tsx runs: data?.results?.streams ?? data?.streams
    return NextResponse.json(
      {
        results: {
          streams: sources.streams,
          subtitles: sources.subtitles || [],
          skipTimes: sources.skipTimes || null
        }
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=600, stale-while-revalidate=30",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );

  } catch (error: any) {
    console.error("[Watch API Engine Crash]:", error);

    // Guard against Miruro's standard IP block / Connection Reset codes safely
    if (error.message?.includes("Pipe request failed")) {
      return NextResponse.json(
        { error: "Target provider rejected server connection. Please try again.", details: error.message },
        { status: 502 }
      );
    }

    // Prevents unhandled 500 screen crashes by serving a clear structured JSON error box
    return NextResponse.json(
      { error: "Internal Scraper Extraction Fault", message: error.message },
      { status: 500 }
    );
  }
}
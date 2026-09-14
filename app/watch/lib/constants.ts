// ---- Constants shared across the watch page ----

export const STABILITY_PRIORITY = ["bee", "kiwi", "pewe", "bonk"];
export const SKIP_COUNTDOWN_DURATION = 7000; // 7 seconds timeout for Netflix-style skip button
export const MAX_VOLUME = 1.5; // volume slider ceiling — 1.0 is "true" full volume,
                               // 1.0–1.5 is a WebAudio-driven boost for quiet sources

// ---- TMDB metadata enrichment (anime titles only) --------------------------------
// The anime provider APIs (bee/kiwi/pewe/bonk) remain the source of truth for actual
// stream resolution — episode ids/slugs used to build watch links always come from
// them. TMDB is used purely to dress up the episode/season browsing UI (real
// thumbnails, synopses, season groupings) for well-known titles like One Piece,
// mirroring what the /anime/[id] detail page already does.
export const TMDB_API_KEY = "e0554f6521da4365d4a36ea7ff17ae51";
export const TMDB_IMG = "https://image.tmdb.org/t/p";

// AniList IDs whose TMDB metadata enrichment is deliberately disabled. One Piece
// (21) lists specials/OVAs as separate TMDB seasons, so cumulative season offsets
// never line up with providers' flat absolute episode numbering (e.g. ep 1016),
// producing wrong titles/descriptions/thumbnails. Provider data remains the
// source of truth for these titles.
export const TMDB_ENRICHMENT_DISABLED_ANILIST_IDS = new Set<string>(["21"]);

// ---- Adaptive quality targeting --------------------------------------------------
// Playback begins on a low variant (highest level <= STARTUP_MAX_HEIGHT, i.e.
// ~720p) so time-to-first-frame stays quick, then hls.js ABR climbs back up
// automatically — capped at TARGET_MAX_HEIGHT (1080p Full HD) so we never
// stream beyond the default target quality. Shared by BOTH pipelines (anime +
// external).
export const STARTUP_MAX_HEIGHT = 720;
export const TARGET_MAX_HEIGHT = 1080;

// ---- Watch progress & history ---------------------------------------------------
export const PROGRESS_KEY_PREFIX = "streamanime:progress:";
export const CONTINUE_WATCHING_THRESHOLD = 92; // percent

// ---- Source cache (session window) -----------------------------------------------
export const SOURCE_CACHE_KEY = "streamanime_source_cache";
export const SOURCE_CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes — quick replay within session

// ---- Persistent source cache (7-day window) --------------------------------------
export const PERSISTENT_SOURCE_CACHE_KEY = "streamanime_persistent_source_cache";
export const PERSISTENT_SOURCE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — across sessions

// ---- Provider preferences & health -----------------------------------------------
export const PROVIDER_PREF_KEY = "streamanime_provider_pref_v1";
export const PROVIDER_HEALTH_KEY = "streamanime_provider_health_v1";
export const DEFAULT_PROVIDER_PREF: Record<string, string> = {
  tv: "dahmermovies",
  movie: "dahmermovies",
  anime: "",
};
export const PROVIDER_SUPPRESSION_MS = 30 * 1000; // 30 seconds

// ---- Stream validation & retry --------------------------------------------------
export const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
export const STREAM_LOAD_TIMEOUT_MS = 30000; // 30 seconds — initial timeout before manifest parses
export const STREAM_LOAD_TIMEOUT_EXTENDED_MS = 45000; // 45 seconds — after manifest/level parses
export const FAST_PROBE_TIMEOUT_MS = 4000; // 4 seconds — single quick probe for first direct HLS
export const FAST_PROBE_ATTEMPTS = 1; // Probe only the first direct HLS candidate

// ---- HLS stream validation -------------------------------------------------------
// Pattern to detect ad-serving hosts in HLS manifests
export const HLS_AD_HOST_PATTERN = /^(https?:)?\/\/.+?ad[sv]?\.?/i;

// ---- TMDB series pagination ------------------------------------------------------
export const TMDB_SERIES_PAGE_SIZE = 20;

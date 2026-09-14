// ---- Shared TypeScript types for the watch page ----

export interface EpisodeSnapshot {
  number?: number;
  title?: string;
  description?: string;
  image?: string;
  anilistId?: string | number;
  tmdbId?: string | number;
  duration?: number;
  tmdbSeasonNumber?: number;
  tmdbEpisodeNumber?: number;
  [key: string]: any;
}

export interface ProviderHealthEntry {
  score: number;
  lastFailure: number;
  consecutiveFailures: number;
}

export interface WatchHistoryEntry {
  anilistId: string;
  episode: number;
  time: number;
  duration: number;
  timestamp: number;
  title?: string;
  image?: string;
}

export interface StreamCandidate {
  provider: string;
  url: string;
  label?: string;
  [key: string]: any;
}

export interface SourceCacheEntry {
  sources: StreamCandidate[];
  timestamp: number;
  episodeKey: string;
}

export interface SkipInterval {
  startTime: number;
  endTime: number;
  [key: string]: any;
}

export interface SkipIntervalItem {
  interval: {
    startTime: number;
    endTime: number;
  };
  skipType: "op" | "ed" | "mixed-op" | "mixed-ed" | "recap" | string;
  skipId?: string;
  episodeLength?: number;
}

// ---- Stream pipeline context interface ----
// Shared context passed to both the anime and external stream pipeline hooks.
// This encapsulates all the refs and state setters the pipelines need without
// forcing them to live in the same component.
export interface StreamPipelineContext {
  // Refs
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hlsRef: React.RefObject<any | null>;
  abortControllerRef: React.RefObject<AbortController | null>;
  playbackGenerationRef: React.RefObject<number>;
  sourceAttemptRef: React.RefObject<number>;
  sourceStateRef: React.RefObject<string>;
  activeSourceUrlRef: React.RefObject<string>;
  streamTimeoutRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  mediaSuccessHandlerRef: React.RefObject<(() => void) | null>;
  mediaProgressHandlerRef: React.RefObject<(() => void) | null>;
  providerHealthRef: React.RefObject<Record<string, ProviderHealthEntry>>;
  savedTimeRef: React.RefObject<{ time: number; updatedAt: number } | null>;
  forceStartFromZeroRef: React.RefObject<boolean>;
  playbackHasStartedRef: React.RefObject<boolean>;

  // State values
  isExternalMedia: boolean;
  loading: boolean;
  isPlaying: boolean;
  captionsEnabled: boolean;
  playbackHasStarted: boolean;
  autoplay: boolean;

  // URL params
  anilistId: string;
  epNum: string;
  seasonNum: string;
  currentSlug: string;
  category: string | null;
  mediaType: string;
  urlProvider: string | null;
  provider: string;

  // State setters
  setLoading: (v: boolean) => void;
  setStatus: (v: string) => void;
  setIsPlaying: (v: boolean) => void;
  setError: (v: string) => void;
  setStreamSrc: (v: string | null) => void;
  setVideoQuality: (v: string) => void;
  setEpisodeSnapshot: (v: EpisodeSnapshot) => void;
  setSubtitles: (v: any[]) => void;
  setSubtitlesEnabled: (v: boolean) => void;
  setCaptionsEnabled: (v: boolean) => void;
  setSkipIntervals: (v: SkipInterval[]) => void;

  // Pipeline-specific state (external)
  selectedProvider?: string | null;
  isExternalMovie?: boolean;
  imdbId?: string;
  tmdbShowId?: string | null;
  failedExternalSources?: React.RefObject<Set<string>>;
  externalPoolIndex?: React.RefObject<number>;
  externalPool?: React.RefObject<StreamCandidate[]>;
  externalRecoveryCycles?: React.RefObject<number>;
  getCachedOmdbRuntime?: () => string;
  activeRouteIdentityRef?: React.RefObject<string>;
  previousMediaIdentityRef?: React.RefObject<string>;
}

// ---- TMDB metadata enrichment types (anime titles only) ----
export interface TmdbSeasonInfo {
  number: number;
  name: string;
  poster?: string;
  episodeCount: number;
  absoluteOffset: number; // sum of episode counts of all prior seasons — lets us map
                            // the provider's flat/absolute episode numbering onto a season
}

export interface TmdbEpisodeMeta {
  title?: string;
  description?: string;
  image?: string;
  runtimeMinutes?: number;
}

// ---- Watch-progress persistence types ----
export type ProgressEntry = { percent: number; positionSeconds?: number; updatedAt: number };
export type ProgressMap = Record<string, ProgressEntry> & { lastWatched?: { season: number; episode: number } };

// ---- Episode node interface for episode listing ----
export interface EpisodeNode {
  id: string;
  number: number;
  title?: string;
  description?: string;
  image?: string;
  slug?: string;
  /** Runtime in minutes, when TMDB provides it for this episode. Used only
   *  for the duration badge in the sidebar list — we never fabricate this. */
  runtimeMinutes?: number;
}

// ---- UI view style type ----
export type ViewStyle = "compact" | "detailed";

// ---- HLS.js variant/level types ----
/** Minimal structural view of an hls.js variant/level row. */
export type HlsLevelLike = { height?: number };

/** HLS candidate stream (URL + referer). */
export type HlsCandidate = { url: string; referer: string };

/** Validated HLS stream with playback mode (direct or proxied). */
export type ValidatedStream = HlsCandidate & { mode: "direct" | "proxy" };

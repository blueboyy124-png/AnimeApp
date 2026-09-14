export interface AnimeCard {
  id: string | number;
  title?: any;
  name?: string;
  coverImage?: string;
  image?: string;
  poster?: string;
  cover?: string;
  poster_path?: string;
  backdrop_path?: string;
  bannerImage?: string;
  description?: string;
  overview?: string;
  genres?: string[];
  type?: string;
  format?: string;
  media_type?: string;
  genre_ids?: number[];
  original_language?: string;
  averageScore?: number;
  seasonYear?: string;
}

export interface WatchHistoryItem {
  anilistId: string;
  animeTitle: string;
  episodeNumber: string;
  episodeImage: string;
  currentTime: number;
  duration: number;
  progressPercent: number;
  provider: string;
  category: string;
  slug: string;
  updatedAt: number;
  mediaType?: "anime" | "movie" | "tv";
  season?: string;
  seasonName?: string;
}

export type FeedCategory = "trending" | "upcoming" | "recommendations" | "popular";

// Used for the "Because you watched X" rows (movieRecs/tvRecs/animeRecs).
export interface SeededRecommendationRow {
  seedTitle: string;
  items: AnimeCard[];
}

// Card-hover/click impression tracking callbacks, threaded down from
// page.tsx (which owns hoverStartRef + the currentProfile-scoped
// recordImpression calls) into every component that renders cards.
export interface CardInteractionHandlers {
  onHoverStart?: (impressionKey: string) => void;
  onHoverEnd?: (impressionKey: string) => void;
  onCardClick?: (impressionKey: string) => void;
}

export type SiteBannerTheme = "info" | "success" | "warning" | "danger" | "promo";

export interface SiteBannerConfig {
  id: string;
  enabled: boolean;
  message: string;
  linkHref: string | null;
  linkLabel: string | null;
  theme: SiteBannerTheme;
  dismissible: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

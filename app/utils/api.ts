export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const { hostname } = window.location;
    if (hostname === "localhost" || hostname === "192.168.86.32" || hostname === "0.0.0.0") {
      return "http://192.168.86.32:3000/api";
    }

    if (hostname === "192.168.86.32") {
      return "http://192.168.86.32:3000/api";
    }
  }

  return "http://192.168.86.32:3000/api";
}

/**
 * The TMDB Embed API is a separate service from the anime API above. Keep its
 * origin configurable so a phone or deployed site does not accidentally point
 * at its own localhost instead of the machine running the stream providers.
 */
export function getTmdbEmbedApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_TMDB_EMBED_API_URL?.trim();
  return (configured || "http://localhost:8787").replace(/\/$/, "");
}

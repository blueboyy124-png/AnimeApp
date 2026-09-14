import { getApiBaseUrl } from "../../utils/api";

const BACKEND_API = getApiBaseUrl();
const animeInfoPromiseCache = new Map<string, Promise<any>>();

export function fetchAnimeInfo(id: number): Promise<any> {
  const key = String(id);
  const existing = animeInfoPromiseCache.get(key);
  if (existing) return existing;
  const request = fetch(`${BACKEND_API}/info/${id}`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  animeInfoPromiseCache.set(key, request);
  if (animeInfoPromiseCache.size > 50) {
    const oldest = animeInfoPromiseCache.keys().next().value;
    if (oldest) animeInfoPromiseCache.delete(oldest);
  }
  return request;
}


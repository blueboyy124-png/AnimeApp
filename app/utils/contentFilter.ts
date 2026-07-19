// Filters mature-tagged items out of a feed/search result list when the
// active profile is a kids profile. Checks the common shapes the AniList
// and TMDB-backed endpoints return (genres array, isAdult flag).
export function filterForKids<T extends { genres?: string[]; isAdult?: boolean }>(
  items: T[],
  isKids: boolean
): T[] {
  if (!isKids) return items;
  return items.filter((item) => {
    if (item.isAdult) return false;
    const genres = (item.genres || []).map((g) => g.toLowerCase());
    return !genres.includes("hentai") && !genres.includes("ecchi");
  });
}
import { STARTUP_MAX_HEIGHT } from "./constants";
import type { HlsLevelLike } from "./types";

/** Index of the highest variant whose height is <= maxHeight; -1 when none qualify. */
export function cappedLevelIndexFor(levels: HlsLevelLike[], maxHeight: number): number {
  let best = -1;
  let bestHeight = 0;
  for (let i = 0; i < levels.length; i++) {
    const height = Number(levels[i]?.height) || 0;
    if (height <= 0 || height > maxHeight) continue;
    if (height > bestHeight) {
      bestHeight = height;
      best = i;
    }
  }
  return best;
}

/** Startup variant index — the best level at/below the fast-start ceiling. */
export function bestStartupLevelIndex(levels: HlsLevelLike[]): number {
  return cappedLevelIndexFor(levels, STARTUP_MAX_HEIGHT);
}

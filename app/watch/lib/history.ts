// ---- Watch history management -------------------------------------------------
import { PROGRESS_KEY_PREFIX } from "./constants";
import type { ProgressMap } from "./types";

export { dedupeHistoryEntriesByTitle, normalizeHistoryTitleKey } from "./utils";

export function loadProgressMap(titleId: string): ProgressMap {
  if (typeof window === "undefined" || !titleId) return {};
  try {
    const raw = window.localStorage.getItem(`${PROGRESS_KEY_PREFIX}${titleId}`);
    return raw ? (JSON.parse(raw) as ProgressMap) : {};
  } catch {
    return {};
  }
}

export const getResumeTimeKey = (anilistId: string, epNum: string): string =>
  `streamanime_resume_${anilistId}_${epNum}`;

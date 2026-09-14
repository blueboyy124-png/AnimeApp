// ══════════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE
//
// A from-scratch, client-side recommendation layer that replaces plain
// genre-string matching with continuous trait vectors ("StoryDNA"), a
// hybrid multi-signal score, and an adaptive, mood-aware homepage.
//
// HONEST SCOPE NOTE: this runs entirely in the browser, with no backend,
// no database, and no other users' data to learn from. That means two
// pieces of the original proposal aren't literally possible here:
//   - "Collaborative filtering" needs other people's behavior to compare
//     against. We don't have that, so we use TMDB's own /recommendations
//     endpoint as a stand-in — it's genuinely collaborative-filtering-based
//     under the hood, just computed by TMDB instead of us.
//   - "512-dim embeddings" need an embedding model to run against. We use
//     a hand-built ~12-dimensional continuous trait vector instead, scored
//     from genres + synopsis keywords. It's a heuristic, not a trained
//     model — real, useful, but not literally an embedding.
// Everything else (StoryDNA traits, hybrid weighting, taste drift,
// impression tracking, anti-fatigue diversification, adaptive rows) is
// implemented for real below.
// ══════════════════════════════════════════════════════════════════════════

export interface StoryDNA {
  pacing: number; // 0 slow burn -> 1 breakneck
  tension: number; // 0 relaxed -> 1 nail-biting
  darkness: number; // 0 light/uplifting -> 1 grimdark/tragic
  comedy: number; // 0 played straight -> 1 comedic
  romance: number; // 0 none -> 1 central
  intellect: number; // 0 simple -> 1 mystery/puzzle/psychological
  spectacle: number; // 0 grounded -> 1 big action/adrenaline
  emotional: number; // 0 detached -> 1 heavy catharsis
  comfort: number; // 0 intense -> 1 cozy/low-stakes
  complexity: number; // 0 monster-of-the-week -> 1 serialized/dense plotting
}

const TRAIT_KEYS: (keyof StoryDNA)[] = [
  "pacing",
  "tension",
  "darkness",
  "comedy",
  "romance",
  "intellect",
  "spectacle",
  "emotional",
  "comfort",
  "complexity",
];

const NEUTRAL_DNA: StoryDNA = {
  pacing: 0.5,
  tension: 0.4,
  darkness: 0.4,
  comedy: 0.3,
  romance: 0.2,
  intellect: 0.4,
  spectacle: 0.4,
  emotional: 0.4,
  comfort: 0.4,
  complexity: 0.4,
};

// Genre -> partial trait contributions. Values are nudges (added, then the
// whole vector is clamped to [0,1]), not absolute settings, so a title with
// several genres blends smoothly instead of snapping to one archetype.
const GENRE_TRAIT_MAP: Record<string, Partial<StoryDNA>> = {
  action: { pacing: 0.3, tension: 0.25, spectacle: 0.35, comfort: -0.2 },
  adventure: { pacing: 0.2, spectacle: 0.2, comfort: 0.05 },
  animation: {},
  comedy: { comedy: 0.45, darkness: -0.25, comfort: 0.25, tension: -0.15 },
  crime: { tension: 0.3, intellect: 0.25, darkness: 0.2 },
  documentary: { pacing: -0.2, intellect: 0.2, spectacle: -0.2 },
  drama: { emotional: 0.35, darkness: 0.15, complexity: 0.1 },
  family: { comfort: 0.35, darkness: -0.3, tension: -0.2 },
  fantasy: { spectacle: 0.2, complexity: 0.15 },
  history: { pacing: -0.15, intellect: 0.15 },
  horror: { tension: 0.45, darkness: 0.35, comfort: -0.35 },
  music: { comfort: 0.15, emotional: 0.1 },
  mystery: { intellect: 0.4, tension: 0.2, complexity: 0.25 },
  romance: { romance: 0.5, emotional: 0.25, comfort: 0.1 },
  "sci-fi": { intellect: 0.2, complexity: 0.2, spectacle: 0.15 },
  "science fiction": { intellect: 0.2, complexity: 0.2, spectacle: 0.15 },
  thriller: { tension: 0.4, pacing: 0.2, complexity: 0.15 },
  war: { darkness: 0.3, tension: 0.25, emotional: 0.2 },
  western: { pacing: -0.1, tension: 0.15 },
  "slice of life": { pacing: -0.35, comfort: 0.4, tension: -0.3 },
  supernatural: { spectacle: 0.15, complexity: 0.1 },
  psychological: { intellect: 0.4, tension: 0.3, darkness: 0.25, complexity: 0.2 },
  sports: { pacing: 0.15, emotional: 0.15, comfort: 0.1 },
  "slow burn": { pacing: -0.4, comfort: 0.2 },
  isekai: { spectacle: 0.15, comfort: 0.1 },
  ecchi: { comedy: 0.15, comfort: 0.1 },
  shounen: { pacing: 0.2, spectacle: 0.25 },
  seinen: { darkness: 0.15, complexity: 0.15, intellect: 0.15 },
};

// Cheap synopsis keyword pass — nudges traits further using signal genres
// alone can't capture (a "war" genre drama and a "war" genre comedy read
// very differently once you look at what the synopsis actually says).
const KEYWORD_TRAIT_MAP: Record<string, Partial<StoryDNA>> = {
  war: { darkness: 0.15, tension: 0.15 },
  revenge: { tension: 0.2, darkness: 0.15 },
  apocalypse: { darkness: 0.2, tension: 0.2, spectacle: 0.15 },
  detective: { intellect: 0.25, complexity: 0.15 },
  murder: { tension: 0.2, darkness: 0.15, intellect: 0.1 },
  heartwarming: { comfort: 0.25, emotional: 0.15, darkness: -0.15 },
  tragic: { emotional: 0.3, darkness: 0.25 },
  tournament: { pacing: 0.2, spectacle: 0.2 },
  conspiracy: { intellect: 0.25, tension: 0.15, complexity: 0.2 },
  friendship: { comfort: 0.2, emotional: 0.15 },
  survival: { tension: 0.3, darkness: 0.15 },
  betrayal: { emotional: 0.2, darkness: 0.15, tension: 0.15 },
  cozy: { comfort: 0.35, pacing: -0.25 },
  epic: { spectacle: 0.25, complexity: 0.15 },
  heist: { pacing: 0.25, tension: 0.2, intellect: 0.15 },
  laugh: { comedy: 0.3, comfort: 0.15 },
  hilarious: { comedy: 0.35, comfort: 0.15 },
  investigation: { intellect: 0.3, complexity: 0.15 },
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Heuristically derives a continuous StoryDNA vector for a title from
 * whatever metadata we actually have (genres + synopsis text + rating).
 * Deterministic and cheap enough to run on an entire feed synchronously.
 */
export function inferStoryDNA(item: {
  genres?: string[];
  overview?: string;
  description?: string;
  averageScore?: number;
}): StoryDNA {
  const dna: StoryDNA = { ...NEUTRAL_DNA };
  const genres = (item.genres || []).map((g) => g.toLowerCase().trim());

  for (const genre of genres) {
    const contrib = GENRE_TRAIT_MAP[genre];
    if (!contrib) continue;
    for (const key of TRAIT_KEYS) {
      if (contrib[key] !== undefined) dna[key] += contrib[key]!;
    }
  }

  const text = `${item.overview || ""} ${item.description || ""}`.toLowerCase();
  for (const [word, contrib] of Object.entries(KEYWORD_TRAIT_MAP)) {
    if (text.includes(word)) {
      for (const key of TRAIT_KEYS) {
        if (contrib[key] !== undefined) dna[key] += contrib[key]! * 0.6; // weaker than genre signal
      }
    }
  }

  // A well-regarded title (averageScore is 0-100 in this codebase) tends to
  // correlate weakly with more deliberate pacing/complexity — a soft nudge,
  // not a strong signal, since plenty of great titles are simple and fun.
  if (typeof item.averageScore === "number" && item.averageScore > 0) {
    const qualityNudge = (item.averageScore / 100 - 0.7) * 0.1;
    dna.complexity += qualityNudge;
    dna.intellect += qualityNudge;
  }

  for (const key of TRAIT_KEYS) dna[key] = clamp01(dna[key]);
  return dna;
}

function dnaToVector(dna: StoryDNA): number[] {
  return TRAIT_KEYS.map((k) => dna[k]);
}

export function cosineSimilarity(a: StoryDNA, b: StoryDNA): number {
  const va = dnaToVector(a);
  const vb = dnaToVector(b);
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    magA += va[i] * va[i];
    magB += vb[i] * vb[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Averages a list of StoryDNA vectors, optionally weighted (e.g. more
// recently watched titles counting more toward the profile).
export function averageDNA(entries: { dna: StoryDNA; weight?: number }[]): StoryDNA {
  if (entries.length === 0) return NEUTRAL_DNA;
  const totals: StoryDNA = { ...NEUTRAL_DNA };
  for (const key of TRAIT_KEYS) totals[key] = 0;
  let totalWeight = 0;
  for (const { dna, weight = 1 } of entries) {
    totalWeight += weight;
    for (const key of TRAIT_KEYS) totals[key] += dna[key] * weight;
  }
  if (totalWeight === 0) return NEUTRAL_DNA;
  for (const key of TRAIT_KEYS) totals[key] = totals[key] / totalWeight;
  return totals;
}

// ── Taste Drift: permanent profile (slow-moving) + session profile (fast) ──

export interface TasteProfile {
  permanent: StoryDNA;
  updatedAt: number;
  sampleCount: number;
}

const TASTE_KEY_PREFIX = "streamanime_taste_profile_";

export function loadPermanentTaste(profileId: string): TasteProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${TASTE_KEY_PREFIX}${profileId}`);
    return raw ? (JSON.parse(raw) as TasteProfile) : null;
  } catch {
    return null;
  }
}

// Exponential moving average — each visit's fresh watch history nudges the
// permanent profile instead of overwriting it, so one binge of an outlier
// genre doesn't instantly rewrite someone's long-term taste.
export function updatePermanentTaste(profileId: string, freshDNA: StoryDNA): TasteProfile {
  const existing = loadPermanentTaste(profileId);
  const alpha = existing ? 0.25 : 1; // first-ever write just takes the fresh value
  const blended: StoryDNA = { ...NEUTRAL_DNA };
  for (const key of TRAIT_KEYS) {
    blended[key] = existing ? existing.permanent[key] * (1 - alpha) + freshDNA[key] * alpha : freshDNA[key];
  }
  const next: TasteProfile = {
    permanent: blended,
    updatedAt: Date.now(),
    sampleCount: (existing?.sampleCount || 0) + 1,
  };
  try {
    localStorage.setItem(`${TASTE_KEY_PREFIX}${profileId}`, JSON.stringify(next));
  } catch {
    // storage unavailable — permanent taste just won't persist this session
  }
  return next;
}

export interface SessionMood {
  energyLevel: number; // 0 (winding down) -> 1 (high energy)
  label: "late-night" | "weekend-binge" | "weekday-evening" | "daytime";
}

// Derives a lightweight "mood" purely from *when* someone's browsing —
// no invasive tracking, just local clock + day of week.
export function deriveSessionMood(now: Date = new Date()): SessionMood {
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = day === 0 || day === 6;

  if (hour >= 23 || hour < 5) {
    return { energyLevel: 0.15, label: "late-night" };
  }
  if (isWeekend && hour >= 10 && hour < 22) {
    return { energyLevel: 0.75, label: "weekend-binge" };
  }
  if (hour >= 18 && hour < 23) {
    return { energyLevel: 0.4, label: "weekday-evening" };
  }
  return { energyLevel: 0.6, label: "daytime" };
}

// Blends the slow-moving permanent taste with the session mood into
// "today's homepage" target vector — the reviewer's Taste Drift idea.
export function blendTasteForToday(permanent: StoryDNA, mood: SessionMood): StoryDNA {
  const moodTarget: StoryDNA =
    mood.label === "late-night"
      ? { ...NEUTRAL_DNA, comfort: 0.85, pacing: 0.2, tension: 0.15, darkness: 0.2, comedy: 0.4 }
      : mood.label === "weekend-binge"
      ? { ...NEUTRAL_DNA, pacing: 0.7, spectacle: 0.65, complexity: 0.6 }
      : { ...NEUTRAL_DNA };

  const sessionWeight = 0.3; // permanent taste still dominates day to day
  const blended: StoryDNA = { ...NEUTRAL_DNA };
  for (const key of TRAIT_KEYS) {
    blended[key] = clamp01(permanent[key] * (1 - sessionWeight) + moodTarget[key] * sessionWeight);
  }
  return blended;
}

// ── Impression tracking: richer than "clicked or not" ──────────────────────

export interface ImpressionEvent {
  hoverDuration: number; // ms
  clicked: boolean;
  dismissed: boolean; // hovered a meaningful amount, but never clicked
  timesSeen: number;
  lastSeen: number;
}

const IMPRESSION_KEY_PREFIX = "streamanime_impressions_";
const DISMISSAL_HOVER_THRESHOLD_MS = 1800;

function loadImpressionMap(profileId: string): Record<string, ImpressionEvent> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(`${IMPRESSION_KEY_PREFIX}${profileId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveImpressionMap(profileId: string, map: Record<string, ImpressionEvent>) {
  try {
    localStorage.setItem(`${IMPRESSION_KEY_PREFIX}${profileId}`, JSON.stringify(map));
  } catch {
    // non-fatal — impression history just won't persist this session
  }
}

// Call when a card's hover ends (or on click). hoverDurationMs of 0 with
// clicked=true is fine — an instant, decisive click is itself a signal.
export function recordImpression(
  profileId: string,
  itemKey: string,
  hoverDurationMs: number,
  clicked: boolean
): void {
  const map = loadImpressionMap(profileId);
  const existing = map[itemKey];
  const dismissed = !clicked && hoverDurationMs >= DISMISSAL_HOVER_THRESHOLD_MS;
  map[itemKey] = {
    hoverDuration: existing ? Math.max(existing.hoverDuration, hoverDurationMs) : hoverDurationMs,
    clicked: clicked || existing?.clicked || false,
    dismissed: dismissed || existing?.dismissed || false,
    timesSeen: (existing?.timesSeen || 0) + 1,
    lastSeen: Date.now(),
  };
  saveImpressionMap(profileId, map);
}

export function getImpressionMap(profileId: string): Record<string, ImpressionEvent> {
  return loadImpressionMap(profileId);
}

// ── Hybrid scoring ───────────────────────────────────────────────────────

export interface HybridScoreInputs {
  candidateDNA: StoryDNA;
  todayTasteTarget: StoryDNA;
  isInCollaborativePool: boolean; // came back from a TMDB /recommendations call
  popularityScore: number; // 0-1, normalized averageScore
  sessionMood: SessionMood;
  impression?: ImpressionEvent;
  alreadyWatched: boolean;
}

// Weights mirror the reviewer's proposed split:
//   35% collaborative-style signal, 35% content similarity,
//   20% session/mood context, 10% exploration/discovery.
export function hybridScore(inputs: HybridScoreInputs): number {
  const {
    candidateDNA,
    todayTasteTarget,
    isInCollaborativePool,
    popularityScore,
    sessionMood,
    impression,
    alreadyWatched,
  } = inputs;

  if (alreadyWatched) return -1; // never recommend what they've already seen

  const collaborativeSignal = isInCollaborativePool ? 0.85 : popularityScore * 0.5;
  const contentSimilarity = cosineSimilarity(candidateDNA, todayTasteTarget);
  const moodAlignment =
    sessionMood.label === "late-night"
      ? candidateDNA.comfort * 0.7 + (1 - candidateDNA.tension) * 0.3
      : sessionMood.label === "weekend-binge"
      ? candidateDNA.spectacle * 0.6 + candidateDNA.pacing * 0.4
      : candidateDNA.emotional * 0.5 + candidateDNA.intellect * 0.5;

  // Novelty rewards items with little exposure so far, and gently penalizes
  // ones the person has already hovered-and-passed-on repeatedly — the
  // "interesting but not today" signal from the hesitation tracking.
  let novelty = 1 - Math.min(1, popularityScore); // under-the-radar bonus by default
  if (impression) {
    if (impression.clicked) novelty = 0; // already engaged with, no discovery bonus needed
    else if (impression.dismissed) novelty *= Math.max(0.15, 1 - impression.timesSeen * 0.2);
  }

  let score = collaborativeSignal * 0.35 + contentSimilarity * 0.35 + moodAlignment * 0.2 + novelty * 0.1;

  // Extra fatigue penalty for something repeatedly seen-and-skipped, layered
  // on top of the reduced novelty term above.
  if (impression?.dismissed && !impression.clicked) {
    score *= Math.max(0.4, 1 - impression.timesSeen * 0.12);
  }

  return score;
}

// ── Anti-fatigue diversification (Phase 3's clustering logic) ─────────────

function dominantTrait(dna: StoryDNA): keyof StoryDNA {
  let best: keyof StoryDNA = "pacing";
  let bestVal = -Infinity;
  for (const key of TRAIT_KEYS) {
    if (dna[key] > bestVal) {
      bestVal = dna[key];
      best = key;
    }
  }
  return best;
}

/**
 * Re-orders a score-sorted list so the top of the feed doesn't turn into
 * five nearly-identical grimdark thrillers in a row. Titles whose dominant
 * trait has already appeared twice near the top get pushed down instead of
 * dropped, so nothing disappears — the feed just breathes a little.
 */
export function diversifyByDominantTrait<T>(
  scoredItems: { item: T; score: number; dna: StoryDNA }[],
  maxPerCluster = 2
): T[] {
  const clusterCounts: Record<string, number> = {};
  const primary: typeof scoredItems = [];
  const overflow: typeof scoredItems = [];

  for (const entry of scoredItems) {
    const cluster = dominantTrait(entry.dna);
    const count = clusterCounts[cluster] || 0;
    if (count < maxPerCluster) {
      clusterCounts[cluster] = count + 1;
      primary.push(entry);
    } else {
      overflow.push(entry);
    }
  }

  return [...primary, ...overflow].map((e) => e.item);
}

export { TRAIT_KEYS, NEUTRAL_DNA };
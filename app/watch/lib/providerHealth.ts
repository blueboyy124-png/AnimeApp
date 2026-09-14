import type { ProviderHealthEntry } from "./types";
import {
  PROVIDER_PREF_KEY,
  PROVIDER_HEALTH_KEY,
  DEFAULT_PROVIDER_PREF,
  PROVIDER_SUPPRESSION_MS,
} from "./constants";

// ---- Live provider preferences & timestamp suppression (active page logic) ----

export function loadProviderPref(): Record<string, string> {
  if (typeof window === "undefined") return { ...DEFAULT_PROVIDER_PREF };
  try {
    return { ...DEFAULT_PROVIDER_PREF, ...(JSON.parse(localStorage.getItem(PROVIDER_PREF_KEY) || "{}")) };
  } catch {
    return { ...DEFAULT_PROVIDER_PREF };
  }
}

export function saveProviderPref(pref: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PROVIDER_PREF_KEY, JSON.stringify(pref));
  } catch {
    // non-fatal
  }
}

export function loadProviderHealth(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PROVIDER_HEALTH_KEY) || "{}");
  } catch {
    return {};
  }
}

export function markProviderFailure(providerName: string): void {
  if (!providerName || typeof window === "undefined") return;
  try {
    const health = loadProviderHealth();
    health[providerName] = Date.now() + PROVIDER_SUPPRESSION_MS;
    localStorage.setItem(PROVIDER_HEALTH_KEY, JSON.stringify(health));
  } catch {}
}

export function clearProviderFailure(providerName: string): void {
  if (!providerName || typeof window === "undefined") return;
  try {
    const health = loadProviderHealth();
    delete health[providerName];
    localStorage.setItem(PROVIDER_HEALTH_KEY, JSON.stringify(health));
  } catch {}
}

export function isProviderSuppressed(providerName: string): boolean {
  if (!providerName || typeof window === "undefined") return false;
  const until = loadProviderHealth()[providerName] || 0;
  return until > Date.now();
}

// ---- Legacy score helpers (kept intact for type compatibility) ----

export function initProviderHealthRef(
  ref: React.RefObject<Record<string, ProviderHealthEntry>>,
  provider: string
): void {
  if (!ref.current) ref.current = {};
  if (!ref.current[provider]) {
    ref.current[provider] = { score: 100, lastFailure: 0, consecutiveFailures: 0 };
  }
}

export function getProviderHealth(
  ref: React.RefObject<Record<string, ProviderHealthEntry>>,
  provider: string
): ProviderHealthEntry {
  if (!ref.current) return { score: 100, lastFailure: 0, consecutiveFailures: 0 };
  return ref.current[provider] || { score: 100, lastFailure: 0, consecutiveFailures: 0 };
}

export function getProviderHealthScore(
  ref: React.RefObject<Record<string, ProviderHealthEntry>>,
  provider: string
): number {
  return getProviderHealth(ref, provider).score;
}

export function recordProviderSuccess(
  ref: React.RefObject<Record<string, ProviderHealthEntry>>,
  provider: string
): void {
  if (!ref.current) ref.current = {};
  if (!ref.current[provider]) {
    ref.current[provider] = { score: 100, lastFailure: 0, consecutiveFailures: 0 };
  }
  const entry = ref.current[provider];
  entry.score = Math.min(100, entry.score + 5);
  entry.consecutiveFailures = 0;
}

export function recordProviderFailure(
  ref: React.RefObject<Record<string, ProviderHealthEntry>>,
  provider: string
): void {
  if (!ref.current) ref.current = {};
  if (!ref.current[provider]) {
    ref.current[provider] = { score: 100, lastFailure: 0, consecutiveFailures: 0 };
  }
  const entry = ref.current[provider];
  entry.score = Math.max(0, entry.score - 25);
  entry.lastFailure = Date.now();
  entry.consecutiveFailures++;
}

export function shouldDeprioritizeProvider(
  ref: React.RefObject<Record<string, ProviderHealthEntry>>,
  provider: string
): boolean {
  const health = getProviderHealth(ref, provider);
  if (health.score < 30) return true;
  if (health.consecutiveFailures >= 3 && Date.now() - health.lastFailure < 30000) return true;
  return false;
}

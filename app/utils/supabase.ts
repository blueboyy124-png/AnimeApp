import { createClient } from '@supabase/supabase-js';

// Fallback to your explicit project string if process env variables are missing during a build worker run
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://itjzuocsxemrhdfiormr.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0anp1b2NzeGVtcmhkZmlvcm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjkzNDYsImV4cCI6MjA5ODI0NTM0Nn0.olmwxwf3QNTVrJrCk2QjJhTEdQHs95EsSNdVdW_8YQs";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const MAX_PROFILES = 5;

export interface SupabaseAccount {
  id: string;
  username: string;
  email: string;
  needs_password_setup: boolean;
  created_at: string;
}

export interface SupabaseProfile {
  id: string;
  account_id: string;
  name: string;
  avatar_url: string;
  is_kids: boolean;
  recent_episodes: any[];
  created_at?: string;
}

// ══════════════════════════════════════════════════════════════
// USERNAME <-> EMAIL
// Supabase Auth only knows email+password. We store username
// alongside it in `accounts` and resolve it server-side via an RPC
// (see supabase_migration.sql) so a plain username login still works.
// ══════════════════════════════════════════════════════════════

export async function resolveEmailForUsername(username: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolve_username_email', { p_username: username.trim() });
  if (error) {
    console.error("[auth] username lookup failed:", error.message);
    return null;
  }
  return (data as string) || null;
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const email = await resolveEmailForUsername(username);
  return !!email;
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

export async function signUpAccount(username: string, email: string, password: string) {
  const cleanUsername = username.trim();
  if (!cleanUsername) throw new Error("Username is required.");
  if (cleanUsername.length < 3) throw new Error("Username must be at least 3 characters.");
  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) throw new Error("Username can only contain letters, numbers, and underscores.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  if (await isUsernameTaken(cleanUsername)) {
    throw new Error("That username is already taken.");
  }

  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) throw error;

  const userId = data.user?.id;
  if (!userId) {
    throw new Error("Check your email to confirm your account, then log in.");
  }

  const { error: accountError } = await supabase.from("accounts").insert({
    id: userId,
    username: cleanUsername,
    email: email.trim(),
    needs_password_setup: false,
  });
  if (accountError) throw accountError;

  return data;
}

export async function signInWithUsername(username: string, password: string) {
  const email = await resolveEmailForUsername(username);
  if (!email) throw new Error("No account found with that username.");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Incorrect username or password.");
  return data;
}

export async function signOutAccount() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentAccount(): Promise<SupabaseAccount | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase.from("accounts").select("*").eq("id", uid).maybeSingle();
  if (error || !data) return null;
  return data as SupabaseAccount;
}

// Used by the "No password for this account" flow: sets a real password
// on the currently-authenticated session and clears the flag.
export async function setAccountPassword(newPassword: string) {
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;

  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (uid) {
    await supabase.from("accounts").update({ needs_password_setup: false }).eq("id", uid);
  }
}

// ══════════════════════════════════════════════════════════════
// PROFILES
// ══════════════════════════════════════════════════════════════

export async function listProfiles(accountId: string): Promise<SupabaseProfile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as SupabaseProfile[];
}

export async function createProfile(
  accountId: string,
  name: string,
  avatarUrl: string,
  isKids: boolean
): Promise<SupabaseProfile> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Profile name is required.");

  const existing = await listProfiles(accountId);
  if (existing.length >= MAX_PROFILES) {
    throw new Error(`You can only have up to ${MAX_PROFILES} profiles.`);
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      account_id: accountId,
      name: cleanName,
      avatar_url: avatarUrl,
      is_kids: isKids,
      recent_episodes: [],
    })
    .select()
    .single();

  if (error) throw error;
  return data as SupabaseProfile;
}

export async function updateProfile(
  profileId: string,
  updates: Partial<Pick<SupabaseProfile, "name" | "avatar_url" | "is_kids">>
) {
  const { error } = await supabase.from("profiles").update(updates).eq("id", profileId);
  if (error) throw error;
}

export async function deleteProfile(profileId: string) {
  const { error } = await supabase.from("profiles").delete().eq("id", profileId);
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
// WATCH HISTORY SYNC
// The watch page and homepage both write/read a per-profile
// localStorage cache (`streamanime_watch_history_<profileId>`) for
// speed, and write-through to `profiles.recent_episodes` on every
// playback update. But nothing ever pulled recent_episodes back OUT
// of Supabase — so a second device (or a fresh browser) never saw
// history that was recorded elsewhere. This merges the two: whatever
// device/browser has the newer `updatedAt` per episode wins.
// ══════════════════════════════════════════════════════════════

export function mergeWatchHistory(local: any[], remote: any[]): any[] {
  const map = new Map<string, any>();
  for (const item of [...(local || []), ...(remote || [])]) {
    if (!item || item.anilistId === undefined || item.episodeNumber === undefined) continue;
    const key = `${item.anilistId}:${item.episodeNumber}`;
    const existing = map.get(key);
    if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 20);
}

// Call this whenever a profile becomes the active one (selected from the
// picker, or restored on page load) — merges Supabase's copy of this
// profile's history into its local cache so every screen that reads
// localStorage (homepage feed, watch-page resume) is in sync immediately.
export function syncWatchHistoryToLocalCache(profile: SupabaseProfile): any[] {
  const key = `streamanime_watch_history_${profile.id}`;
  const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
  const local = raw ? JSON.parse(raw) : [];
  const merged = mergeWatchHistory(local, profile.recent_episodes || []);
  if (typeof window !== "undefined") localStorage.setItem(key, JSON.stringify(merged));
  return merged;
}
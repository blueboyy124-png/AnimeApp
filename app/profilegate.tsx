"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import AuthPage from "./AuthPage";
import ProfilePage from "./ProfilePage";
import {
  supabase,
  getCurrentAccount,
  listProfiles,
  signOutAccount,
  syncWatchHistoryToLocalCache,
  SupabaseAccount,
  SupabaseProfile,
} from "./utils/supabase";

const ACTIVE_PROFILE_KEY = "streamanime_active_profile_id";

interface ProfileContextValue {
  account: SupabaseAccount;
  profile: SupabaseProfile;
  switchProfile: () => void;
  logout: () => void;
  needsPasswordSetup: boolean;
  openSetPassword: () => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

// Used by the homepage (and anywhere else inside the gate) to get the
// active profile/account without prop drilling.
export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile() must be used inside <ProfileGate>");
  return ctx;
}

export default function ProfileGate({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState<SupabaseAccount | null>(null);
  const [profiles, setProfiles] = useState<SupabaseProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<SupabaseProfile | null>(null);
  const [showSetPassword, setShowSetPassword] = useState(false);

  const loadAccountAndProfiles = async () => {
    const acct = await getCurrentAccount();
    setAccount(acct);

    if (!acct) {
      setProfiles([]);
      setActiveProfile(null);
      return;
    }

    const list = await listProfiles(acct.id);
    setProfiles(list);

    const storedId = localStorage.getItem(ACTIVE_PROFILE_KEY);
    const restored = storedId ? list.find((p) => p.id === storedId) : null;
    if (restored) syncWatchHistoryToLocalCache(restored);
    setActiveProfile(restored || null);
  };

  useEffect(() => {
    loadAccountAndProfiles().finally(() => setBooting(false));

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setAccount(null);
        setProfiles([]);
        setActiveProfile(null);
      }
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectProfile = (profile: SupabaseProfile) => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, profile.id);
    syncWatchHistoryToLocalCache(profile);
    setActiveProfile(profile);
  };

  const handleSwitchProfile = () => {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
    setActiveProfile(null);
  };

  const handleLogout = async () => {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
    await signOutAccount();
    setAccount(null);
    setProfiles([]);
    setActiveProfile(null);
  };

  if (booting) {
    return (
      <div className="relative min-h-screen bg-neutral-950 text-neutral-100 font-sans antialiased flex flex-col items-center justify-center space-y-4 overflow-hidden">
        <div
          className="fixed inset-0 pointer-events-none z-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(249,115,22,0.05), transparent 60%)",
          }}
        />
        <div className="relative z-10 animate-spin rounded-full h-8 w-8 border-2 border-orange-500 border-t-transparent" />
        <p className="relative z-10 text-[10px] font-mono tracking-[0.2em] text-neutral-600 uppercase">
          Loading your account
        </p>
      </div>
    );
  }

  if (!account) {
    return <AuthPage mode="login" onSuccess={loadAccountAndProfiles} />;
  }

  if (!activeProfile) {
    return (
      <ProfilePage
        account={account}
        profiles={profiles}
        onProfilesChange={setProfiles}
        onSelectProfile={handleSelectProfile}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <ProfileContext.Provider
      value={{
        account,
        profile: activeProfile,
        switchProfile: handleSwitchProfile,
        logout: handleLogout,
        needsPasswordSetup: account.needs_password_setup,
        openSetPassword: () => setShowSetPassword(true),
      }}
    >
      {children}

      {showSetPassword && (
        <div className="fixed inset-0 z-[60] bg-neutral-950">
          <AuthPage
            mode="set-password"
            lockedUsername={account.username}
            onCancel={() => setShowSetPassword(false)}
            onSuccess={async () => {
              await loadAccountAndProfiles();
              setShowSetPassword(false);
            }}
          />
        </div>
      )}
    </ProfileContext.Provider>
  );
}
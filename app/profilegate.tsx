"use client";

import { useState, useEffect, FormEvent } from "react";
import { supabase, SupabaseProfile } from "./utils/supabase";

interface ProfileGateProps {
  children: React.ReactNode;
  onProfileActive: (profile: SupabaseProfile) => void;
}

export default function ProfileGate({ children, onProfileActive }: ProfileGateProps) {
  const [profiles, setProfiles] = useState<SupabaseProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<SupabaseProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  
  // Auth Modes: "profile_select" | "sign_in" | "create_account"
  const [viewMode, setViewMode] = useState<"profile_select" | "sign_in" | "create_account">("profile_select");

  // Form Fields
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Default Crunchyroll/Netflix style avatars if they don't pick one
  const defaultAvatars = [
    "https://upload.wikimedia.org/wikipedia/commons/0/0b/Netflix-avatar.png",
    "https://wallpapers.com/images/hd/netflix-profile-pictures-1000-x-1000-v71uokwvd1p6mcb5.jpg",
    "https://wallpapers.com/images/hd/netflix-profile-pictures-1000-x-1000-qo9h82134t9nv0j0.jpg",
    "https://images.squarespace-cdn.com/content/v1/5ad4e8673c3a57ca50428fa6/1570138676233-V666UTT3279PTN28N8EP/Crunchyroll_Hime_Chibi_Wink.png"
  ];

  useEffect(() => {
    fetchProfilesFromSupabase();
  }, []);

  const fetchProfilesFromSupabase = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;

      if (data) {
        setProfiles(data);
        
        // Auto-login if id exists in local memory
        const savedId = localStorage.getItem("streamanime_active_profile_id");
        if (savedId) {
          const matched = data.find((p) => p.id === savedId);
          if (matched) {
            handleSelectProfile(matched);
          }
        }
      }
    } catch (err: any) {
      console.error("Supabase Error:", err);
      setErrorMsg("Failed to communicate with database engine.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProfile = (profile: SupabaseProfile) => {
    localStorage.setItem("streamanime_active_profile_id", profile.id);
    // Mirror standard raw database sync history arrays if available
    if (profile.recent_episodes && Array.isArray(profile.recent_episodes)) {
      localStorage.setItem("streamanime_watch_history", JSON.stringify(profile.recent_episodes));
    } else {
      localStorage.setItem("streamanime_watch_history", "[]");
    }
    setActiveProfile(profile);
    onProfileActive(profile);
  };

  const handleCreateAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setActionLoading(true);
    setErrorMsg(null);

    const chosenAvatar = avatarUrl.trim() || defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)];

    try {
      const { data, error } = await supabase
        .from("profiles")
        .insert([{ name: username.trim(), avatar_url: chosenAvatar, recent_episodes: [] }])
        .select()
        .single();

      if (error) throw error;

      if (data) {
        // Clear fields
        setUsername("");
        setAvatarUrl("");
        // Reload list and enter app directly
        await fetchProfilesFromSupabase();
        handleSelectProfile(data);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Could not register new account row.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSignInMock = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setActionLoading(true);
    setErrorMsg(null);

    // Matches profile rows by name instantly for local setup convenience
    const foundProfile = profiles.find(
      (p) => p.name.toLowerCase() === username.trim().toLowerCase()
    );

    if (foundProfile) {
      handleSelectProfile(foundProfile);
    } else {
      setErrorMsg("Account name not found. Check spelling or select 'Create an account'.");
      setActionLoading(false);
    }
  };

  if (activeProfile) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-neutral-950 flex flex-col justify-center items-center text-neutral-100 overflow-y-auto font-sans antialiased selection:bg-orange-500 selection:text-white">
      
      {/* BACKGROUND CINEMATIC AMBIENCE */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(244,117,33,0.08)_0%,transparent_65%)] pointer-events-none" />
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] pointer-events-none" />

      {/* TOP HEADER LOGO */}
      <div className="absolute top-8 sm:top-12 left-4 right-4 text-center z-10 pointer-events-none">
        <h1 className="text-2xl sm:text-4xl font-black tracking-tighter text-orange-500 drop-shadow-md italic">
          STREAMANIME
        </h1>
      </div>

      {/* MAIN CONTAINER PLATFORM CARD */}
      <div className="w-full max-w-md p-6 sm:p-10 bg-neutral-900/70 border border-neutral-800/80 rounded-xl shadow-2xl backdrop-blur-xl mx-4 my-20 relative z-10 transition-all duration-300">
        
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-4">
            <div className="w-8 h-8 border-[3px] border-orange-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-mono tracking-widest text-neutral-500 uppercase">Loading profiles...</p>
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="mb-6 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center font-medium">
                {errorMsg}
              </div>
            )}

            {/* VIEW MODE 1: NETFLIX PROFILE WHO'S WATCHING SEPARATOR */}
            {viewMode === "profile_select" && (
              <div className="space-y-8 text-center animate-fadeIn">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white drop-shadow">
                  Who's Watching?
                </h2>

                {profiles.length === 0 ? (
                  <p className="text-sm text-neutral-400">No viewing profiles active yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto pt-2">
                    {profiles.map((profile) => (
                      <button
                        key={profile.id}
                        onClick={() => handleSelectProfile(profile)}
                        className="group flex flex-col items-center space-y-3 focus:outline-none cursor-pointer"
                      >
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden border-2 border-transparent group-hover:border-orange-500 group-focus:border-orange-500 shadow-lg transition duration-300 relative bg-neutral-800">
                          <img
                            src={profile.avatar_url}
                            alt={profile.name}
                            className="w-full h-full object-cover transition transform duration-300 group-hover:scale-105"
                          />
                        </div>
                        <span className="text-xs sm:text-sm font-medium text-neutral-400 group-hover:text-white transition duration-200 truncate max-w-[100px]">
                          {profile.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="pt-6 border-t border-neutral-800/60 flex flex-col space-y-3">
                  <button
                    onClick={() => setViewMode("sign_in")}
                    className="w-full py-2.5 px-4 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold uppercase tracking-wider transition active:scale-98 shadow-md"
                  >
                    Manage / Sign In
                  </button>
                  <button
                    onClick={() => setViewMode("create_account")}
                    className="w-full py-2.5 px-4 rounded bg-neutral-800 hover:bg-neutral-750 text-neutral-300 text-xs font-bold uppercase tracking-wider border border-neutral-700/50 transition"
                  >
                    Create Account
                  </button>
                </div>
              </div>
            )}

            {/* VIEW MODE 2: CINEMATIC SIGN IN */}
            {viewMode === "sign_in" && (
              <div className="space-y-6 animate-fadeIn">
                <div>
                  <h2 className="text-2xl font-extrabold text-white tracking-tight">Sign In</h2>
                  <p className="text-xs text-neutral-400 mt-1">Access your saved custom dashboard instantly.</p>
                </div>

                <form onSubmit={handleSignInMock} className="space-y-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Account Username</label>
                    <input
                      type="text"
                      required
                      placeholder="Enter username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full p-3 rounded bg-neutral-950 border border-neutral-800 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-orange-500 transition duration-200"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="w-full mt-2 py-3 px-4 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold uppercase tracking-wider transition active:scale-98 disabled:opacity-50"
                  >
                    {actionLoading ? "Verifying..." : "Sign In"}
                  </button>
                </form>

                <div className="pt-4 border-t border-neutral-800/60 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-neutral-400">
                  <button onClick={() => { setViewMode("profile_select"); setErrorMsg(null); }} className="hover:text-white transition">
                    &larr; Back to Profiles
                  </button>
                  <div className="flex space-x-1">
                    <span>New here?</span>
                    <button onClick={() => { setViewMode("create_account"); setErrorMsg(null); setUsername(""); }} className="text-orange-500 font-semibold hover:underline">
                      Create an account
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW MODE 3: CRUNCHYROLL STYLE ACCOUNT REGISTRATION */}
            {viewMode === "create_account" && (
              <div className="space-y-6 animate-fadeIn">
                <div>
                  <h2 className="text-2xl font-extrabold text-white tracking-tight">Create Account</h2>
                  <p className="text-xs text-neutral-400 mt-1">Start tracking sync metrics across any video player page.</p>
                </div>

                <form onSubmit={handleCreateAccount} className="space-y-4 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Choose Username</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., AnimeFan99"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full p-3 rounded bg-neutral-950 border border-neutral-800 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-orange-500 transition duration-200"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Avatar URL <span className="text-neutral-600 lowercase">(Optional)</span></label>
                    <input
                      type="url"
                      placeholder="https://example.com/image.png"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      className="w-full p-3 rounded bg-neutral-950 border border-neutral-800 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-orange-500 transition duration-200"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="w-full mt-2 py-3 px-4 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold uppercase tracking-wider transition active:scale-98 disabled:opacity-50"
                  >
                    {actionLoading ? "Provisioning Profile..." : "Create & Enter"}
                  </button>
                </form>

                <div className="pt-4 border-t border-neutral-800/60 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-neutral-400">
                  <button onClick={() => { setViewMode("profile_select"); setErrorMsg(null); }} className="hover:text-white transition">
                    &larr; Back to Profiles
                  </button>
                  <div className="flex space-x-1">
                    <span>Already have one?</span>
                    <button onClick={() => { setViewMode("sign_in"); setErrorMsg(null); setUsername(""); }} className="text-orange-500 font-semibold hover:underline">
                      Log In
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
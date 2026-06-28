"use client";

import { useState, useEffect } from "react";
import { supabase, SupabaseProfile } from "./utils/supabase";

interface ProfileGateProps {
  children: React.ReactNode;
  onProfileActive: (profile: SupabaseProfile) => void;
}

export default function ProfileGate({ children, onProfileActive }: ProfileGateProps) {
  const [profiles, setProfiles] = useState<SupabaseProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<SupabaseProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchProfilesAndSync = async () => {
      try {
        // Fetch accounts from Supabase cloud database
        const { data, error } = await supabase.from("profiles").select("*").order("name", { ascending: true });
        if (error) throw error;
        
        if (data) {
          setProfiles(data);
          
          // Check if local storage remembers who was watching last
          const savedId = localStorage.getItem("streamanime_active_profile_id");
          if (savedId) {
            const foundProfile = data.find(p => p.id === savedId);
            if (foundProfile) {
              setSelectedProfile(foundProfile);
              onProfileActive(foundProfile);
              
              // Load saved profile's watch history straight into local storage cache
              if (foundProfile.recent_episodes) {
                localStorage.setItem("streamanime_watch_history", JSON.stringify(foundProfile.recent_episodes));
              }
            }
          }
        }
      } catch (err) {
        console.error("Error communicating with Supabase engine:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfilesAndSync();
  }, [onProfileActive]);

  const handleSelect = (profile: SupabaseProfile) => {
    localStorage.setItem("streamanime_active_profile_id", profile.id);
    if (profile.recent_episodes) {
      localStorage.setItem("streamanime_watch_history", JSON.stringify(profile.recent_episodes));
    } else {
      localStorage.setItem("streamanime_watch_history", "[]");
    }
    setSelectedProfile(profile);
    onProfileActive(profile);
  };

  const handleCreateProfile = async () => {
    const name = prompt("Enter a profile name:");
    if (!name || !name.trim()) return;

    // Generate a quick random colored robot avatar seed based on name strings
    const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name.trim())}&backgroundColor=ff6b00`;

    const { data, error } = await supabase
      .from("profiles")
      .insert([{ name: name.trim(), avatar_url: avatarUrl }])
      .select();

    if (!error && data) {
      setProfiles(prev => [...prev, data[0]]);
    } else {
      alert(error?.message || "Profile creation failed. Check for duplicate names.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // PREMIUM SELECTION OVERLAY INTERACTION LAYOUT
  if (!selectedProfile) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center font-sans select-none px-4 text-neutral-100 animate-fade-in">
        <h1 className="text-2xl md:text-4xl font-extrabold mb-10 tracking-tight text-center bg-gradient-to-r from-neutral-100 to-neutral-400 bg-clip-text text-transparent">
          Who's watching?
        </h1>
        
        <div className="flex flex-wrap justify-center gap-6 md:gap-10 max-w-4xl">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => handleSelect(profile)}
              className="group flex flex-col items-center space-y-3 focus:outline-none cursor-pointer"
            >
              <div className="w-24 h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 rounded-md overflow-hidden border-2 border-transparent group-hover:border-neutral-100 group-focus:border-orange-500 transition-all duration-300 shadow-2xl relative">
                <img 
                  src={profile.avatar_url} 
                  alt={profile.name} 
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-300 bg-neutral-900" 
                />
              </div>
              <span className="text-xs md:text-sm text-neutral-400 group-hover:text-neutral-100 transition duration-200 font-medium tracking-wide">
                {profile.name}
              </span>
            </button>
          ))}

          {/* ADD ACCOUNT METHOD COMPONENT */}
          <button
            onClick={handleCreateProfile}
            className="group flex flex-col items-center space-y-3 focus:outline-none cursor-pointer"
          >
            <div className="w-24 h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 rounded-md border-2 border-dashed border-neutral-800 group-hover:border-neutral-500 group-hover:bg-neutral-900/30 flex items-center justify-center transition-all duration-300">
              <span className="text-3xl font-light text-neutral-600 group-hover:text-neutral-300 transition duration-300">+</span>
            </div>
            <span className="text-xs md:text-sm text-neutral-600 group-hover:text-neutral-400 transition duration-200 font-medium">
              Add Profile
            </span>
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
"use client";

import { useState, useEffect, FormEvent } from "react";
import { loadProfile } from "./utils/profile"; // Navigates cleanly into app/utils/profile

export default function AccountBar() {
  const [inputName, setInputName] = useState<string>("");
  const [activeUser, setActiveUser] = useState<string>("");
  const [syncStatus, setSyncStatus] = useState<string>("Disconnected");

  useEffect(() => {
    const savedUser = localStorage.getItem("anime_username");
    if (savedUser) {
      setActiveUser(savedUser);
      verifyCloudAccount(savedUser);
    }
  }, []);

  const verifyCloudAccount = async (name: string) => {
    setSyncStatus("Connecting...");
    const cloudData = await loadProfile(name);
    if (cloudData) {
      setSyncStatus("MongoDB Synced ✓");
      console.log("Connected to MongoDB profile:", cloudData);
    } else {
      setSyncStatus("Offline Fallback");
    }
  };

  const handleSignIn = (e: FormEvent) => {
    e.preventDefault();
    if (!inputName.trim()) return;

    const formattedName = inputName.trim().toLowerCase();
    localStorage.setItem("anime_username", formattedName);
    setActiveUser(formattedName);
    verifyCloudAccount(formattedName);
    setInputName("");
  };

  const handleSignOut = () => {
    localStorage.removeItem("anime_username");
    setActiveUser("");
    setSyncStatus("Disconnected");
    window.location.reload();
  };

  return (
    <div className="w-full bg-neutral-900/60 border-b border-neutral-900 px-6 py-2.5 flex items-center justify-between text-xs font-mono text-neutral-400">
      <div className="flex items-center space-x-2">
        <div className={`w-1.5 h-1.5 rounded-full ${syncStatus.includes("✓") ? "bg-green-500 animate-pulse" : "bg-neutral-600"}`} />
        <span>Status: <strong className="text-neutral-200">{syncStatus}</strong></span>
      </div>

      {activeUser ? (
        <div className="flex items-center space-x-4">
          <span>Active Hub: <strong className="text-orange-500 font-bold uppercase tracking-wider">{activeUser}</strong></span>
          <button 
            onClick={handleSignOut}
            className="text-[10px] bg-neutral-950 border border-neutral-800 hover:border-red-900 text-neutral-400 hover:text-red-400 px-2 py-1 rounded cursor-pointer transition"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={handleSignIn} className="flex items-center space-x-2">
          <input
            type="text"
            placeholder="Link cloud profile username..."
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-orange-500/50 w-44 md:w-56 transition"
          />
          <button
            type="submit"
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-3 py-1 rounded cursor-pointer transition text-[11px]"
          >
            Connect
          </button>
        </form>
      )}
    </div>
  );
}
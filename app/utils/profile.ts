const API_BASE = "https://anime-api-one-cyan.vercel.app/api";

export interface RecentEpisode {
  animeTitle: string;
  episodeNum: string | number;
  time?: string;
  [key: string]: any;
}

export interface UserProfile {
  username: string;
  preferredServer: string;
  recentEpisodes: RecentEpisode[];
}

interface ApiResponse {
  success: boolean;
  results?: UserProfile;
  message?: string;
}

export const loadProfile = async (username: string): Promise<UserProfile | null> => {
  try {
    // Force a fresh request without caching to prevent old data loops
    const response = await fetch(`${API_BASE}/profile/${username}`, {
      cache: "no-store"
    });
    
    if (!response.ok) {
      console.error(`Backend returned server error status: ${response.status}`);
      return null;
    }
    
    const data: ApiResponse = await response.json();
    if (data.success && data.results) {
      return data.results;
    }
    return null;
  } catch (error) {
    console.error("Error connecting to cloud profile api:", error);
    return null;
  }
};

export const saveProfile = async (
  username: string,
  preferredServer: string,
  recentEpisodes: RecentEpisode[]
): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/profile/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, preferredServer, recentEpisodes })
    });
    const data: ApiResponse = await response.json();
    return data.success;
  } catch (error) {
    console.error("Error saving cloud profile:", error);
    return false;
  }
};
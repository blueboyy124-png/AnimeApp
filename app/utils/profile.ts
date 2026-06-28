const API_BASE = "https://anime-api-one-cyan.vercel.app/api";

// 1. Define the TypeScript structure for what a Profile contains
export interface RecentEpisode {
  animeTitle: string;
  episodeNum: string | number;
  time?: string;
  [key: string]: any; // Allows flexibility for any extra properties you already track
}

export interface UserProfile {
  username: string;
  preferredServer: string;
  recentEpisodes: RecentEpisode[];
}

// Define the shape of your backend's standard JSON response
interface ApiResponse<T> {
  success: boolean;
  results?: T;
  message?: string;
}

// 2. Fetch data from MongoDB with explicit TS typing
export const loadProfile = async (username: string): Promise<UserProfile | null> => {
  try {
    const response = await fetch(`${API_BASE}/profile/${username}`);
    const data: ApiResponse<UserProfile> = await response.json();
    
    if (data.success && data.results) {
      return data.results; 
    }
    return null;
  } catch (error) {
    console.error("Error loading cloud profile:", error);
    return null;
  }
};

// 3. Save data back to MongoDB with explicit TS typing
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
    const data: ApiResponse<UserProfile> = await response.json();
    return data.success;
  } catch (error) {
    console.error("Error saving cloud profile:", error);
    return false;
  }
};
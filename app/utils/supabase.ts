import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "NEXT_PUBLIC_SUPABASE_URL=https://itjzuocsxemrhdfiormr.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0anp1b2NzeGVtcmhkZmlvcm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjkzNDYsImV4cCI6MjA5ODI0NTM0Nn0.olmwxwf3QNTVrJrCk2QjJhTEdQHs95EsSNdVdW_8YQs"; // Replace with your actual Anon Key

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface SupabaseProfile {
  id: string;
  name: string;
  avatar_url: string;
  preferred_server: string;
  recent_episodes: any[];
}
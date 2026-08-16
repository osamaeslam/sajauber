import { createClient, SupabaseClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bakqdqospbyinoykkdiw.supabase.co';
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJha3FkcW9zcGJ5aW5veWtrZGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MzkzNTIsImV4cCI6MjEwMjQxNTM1Mn0.EyamqnOp2xJz3R0OP_SJoXbeyb_3_xjzP8TAtV_GneQ';

export const isSupabaseConfigured = Boolean(
  rawUrl &&
  rawAnonKey &&
  rawUrl.trim() !== '' &&
  rawAnonKey.trim() !== '' &&
  !rawUrl.includes('your-project-ref') &&
  !rawAnonKey.includes('your_supabase_anon_key')
);

export const SUPABASE_URL = isSupabaseConfigured ? rawUrl : 'https://bakqdqospbyinoykkdiw.supabase.co';
export const SUPABASE_ANON_KEY = isSupabaseConfigured ? rawAnonKey : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJha3FkcW9zcGJ5aW5veWtrZGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MzkzNTIsImV4cCI6MjEwMjQxNTM1Mn0.EyamqnOp2xJz3R0OP_SJoXbeyb_3_xjzP8TAtV_GneQ';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

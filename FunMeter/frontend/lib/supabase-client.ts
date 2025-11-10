// lib/supabase-client.ts
// Supabase client untuk koneksi ke Supabase

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[SUPABASE] NEXT_PUBLIC_SUPABASE_URL atau NEXT_PUBLIC_SUPABASE_ANON_KEY tidak di-set');
}

// Create Supabase client
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // Tidak perlu persist session untuk iklan
    autoRefreshToken: false,
  },
});

// Helper untuk mendapatkan auth token (jika user sudah login)
// Untuk admin operations, gunakan token dari localStorage atau API key
export async function getAuthToken(): Promise<string | null> {
  try {
    // Cek apakah ada session aktif
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return session.access_token;
    }
    
    // Fallback: cek localStorage untuk API key (jika menggunakan custom auth)
    if (typeof window !== 'undefined') {
      const apiKey = localStorage.getItem('fm_token') || localStorage.getItem('api_key');
      if (apiKey) {
        return apiKey;
      }
    }
    
    return null;
  } catch (error) {
    console.error('[SUPABASE] Error getting auth token:', error);
    return null;
  }
}

// Helper untuk membuat Supabase client dengan custom token
export function createSupabaseClientWithToken(token: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}


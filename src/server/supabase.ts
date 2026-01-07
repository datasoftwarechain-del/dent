import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import { env } from '@/server/config';

let adminClient: ReturnType<typeof createClient> | null = null;

export const createSupabaseServerClient = (cookies: AstroCookies) =>
  createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      get(name) {
        return cookies.get(name)?.value;
      },
      set(name, value, options) {
        cookies.set(name, value, { ...options, path: options?.path ?? '/' });
      },
      remove(name, options) {
        cookies.delete(name, { ...options, path: options?.path ?? '/' });
      }
    }
  });

export const getSupabaseAdminClient = () => {
  if (adminClient) return adminClient;
  adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  return adminClient;
};

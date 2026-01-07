import type { APIRoute } from 'astro';
import { json, withErrorHandling } from '@/server/utils/http';
import { createSupabaseServerClient } from '@/server/supabase';

export const POST: APIRoute = withErrorHandling(async ({ cookies }) => {
  const supabase = createSupabaseServerClient(cookies);
  await supabase.auth.signOut();
  return json({ success: true });
});

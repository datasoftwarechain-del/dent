import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export const supabaseBrowser = () =>
  createClient<Database>(
    import.meta.env.PUBLIC_SUPABASE_URL!,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );

import type { APIContext, AstroCookies } from 'astro';
import { supabaseAdmin } from '@/server/db/client';
import { Role, isRoleValue } from '@/server/db/types';
import { createSupabaseServerClient } from '@/server/supabase';

type SessionContext = { cookies: AstroCookies };

export async function getSession(ctx: SessionContext) {
  try {
    const supabase = createSupabaseServerClient(ctx.cookies);
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    const { data: existing, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError) {
      console.error('[auth] profile lookup failed', profileError);
      return null;
    }

    let profile = existing ?? null;
    if (!profile) {
      const roleValue = String(data.user.user_metadata?.role ?? '').toUpperCase();
      const resolvedRole = isRoleValue(roleValue) ? roleValue : Role.CLIENT;
      const { data: created, error: createError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: data.user.id,
          email: data.user.email,
          name: (data.user.user_metadata?.name as string | undefined) ?? null,
          role: resolvedRole
        })
        .select('*')
        .single();

      if (createError || !created) {
        console.error('[auth] profile create failed', createError);
        return null;
      }

      profile = created;
    }

    return { user: profile };
  } catch {
    return null;
  }
}

export const requireRole =
  (roles: Role[]) =>
  async (context: APIContext) => {
    const session = await getSession({ cookies: context.cookies });
    if (!session?.user) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
    if (!roles.includes(session.user.role)) {
      return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
    return undefined;
  };

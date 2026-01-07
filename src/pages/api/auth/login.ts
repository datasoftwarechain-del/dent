import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/server/db/client';
import { Role, isRoleValue } from '@/server/db/types';
import { createSupabaseServerClient } from '@/server/supabase';

const json = (res: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(res), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });



export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    let email = '';
    let password = '';

    if (ct.includes('application/json')) {
      const body = await request.json();
      email = String(body?.email ?? '').trim();
      password = String(body?.password ?? '').trim();
    } else if (
      ct.includes('multipart/form-data') ||
      ct.includes('application/x-www-form-urlencoded')
    ) {
      const form = await request.formData();
      email = String(form.get('email') ?? '').trim();
      password = String(form.get('password') ?? '').trim();
    } else {
      const raw = await request.text();
      try {
        const body = JSON.parse(raw);
        email = String(body?.email ?? '').trim();
        password = String(body?.password ?? '').trim();
      } catch {
        return json({ ok: false, success: false, error: 'Unsupported Content-Type' }, 415);
      }
    }

    if (!email || !password) {
      return json({ ok: false, success: false, error: 'email y password requeridos' }, 400);
    }

    const supabase = createSupabaseServerClient(cookies);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.user) {
      return json({ ok: false, success: false, error: 'credenciales inválidas' }, 401);
    }

    const { data: existing, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError) {
      return json({ ok: false, success: false, error: 'No se pudo validar el perfil' }, 500);
    }

    let profile = existing ?? null;

    if (!profile) {
      const roleValue = String(data.user.user_metadata?.role ?? '').toUpperCase();
      const resolvedRole = isRoleValue(roleValue) ? roleValue : Role.CLIENT;

      const { data: created, error: createError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: data.user.id,
          email: data.user.email ?? email,
          name: (data.user.user_metadata?.name as string | undefined) ?? null,
          role: resolvedRole
        })
        .select('*')
        .single();

      if (createError || !created) {
        return json({ ok: false, success: false, error: 'No se pudo crear el perfil' }, 500);
      }

      profile = created;
    }

    return json(
      {
        ok: true,
        success: true,
        user: { id: profile.id, email: profile.email, name: profile.name, role: profile.role }
      },
      200
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Server error';
    console.error('[login] error', error);
    return json({ ok: false, success: false, error: message }, 500);
  }
};

// GET opcional para probar rápido
export const GET: APIRoute = async () => json({ ok: true, success: true, ping: 'login' });

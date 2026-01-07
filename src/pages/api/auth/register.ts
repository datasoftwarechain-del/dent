import type { APIRoute } from 'astro';
import { Role } from '@/server/db/types';
import { supabaseAdmin } from '@/server/db/client';
import { createSupabaseServerClient } from '@/server/supabase';
import { env } from '@/server/config';

const json = (res: unknown, status = 200) =>
  new Response(JSON.stringify(res), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const GET: APIRoute = async () => json({ ok: true, success: true, ping: 'pong' });

const PUBLIC_ROLES = [
  Role.CLIENT,
  Role.DENTIST,
  Role.LAB,
  Role.CLINIC_ADMIN,
  Role.TECHNICIAN
] as const;

type PublicRole = (typeof PUBLIC_ROLES)[number];

const defaultRole: PublicRole = Role.CLIENT as PublicRole;

const normalizeRole = (value: string | null | undefined): PublicRole => {
  if (!value) return defaultRole;
  const upper = value.trim().toUpperCase();
  const match = PUBLIC_ROLES.find((role) => role === upper);
  return match ?? defaultRole;
};

const parsePayload = async (request: Request) => {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  let name = '';
  let email = '';
  let password = '';
  let role: PublicRole = defaultRole;

  if (ct.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    name = String(body?.name ?? '').trim();
    email = String(body?.email ?? '').trim();
    password = String(body?.password ?? '').trim();
    role = normalizeRole(body?.role);
  } else if (
    ct.includes('multipart/form-data') ||
    ct.includes('application/x-www-form-urlencoded')
  ) {
    const form = await request.formData();
    name = String(form.get('name') ?? '').trim();
    email = String(form.get('email') ?? '').trim();
    password = String(form.get('password') ?? '').trim();
    role = normalizeRole(form.get('role')?.toString());
  } else {
    const raw = await request.text();
    if (raw) {
      try {
        const body = JSON.parse(raw);
        name = String(body?.name ?? '').trim();
        email = String(body?.email ?? '').trim();
        password = String(body?.password ?? '').trim();
        role = normalizeRole(body?.role);
      } catch {
        return { name, email, password, role, unsupported: true };
      }
    }
  }

  return { name, email, password, role, unsupported: false };
};

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const payload = await parsePayload(request);
    if (payload.unsupported) {
      return json({ ok: false, success: false, error: 'Unsupported Content-Type' }, 415);
    }

    const { email, password, name, role } = payload;

    if (!email || !password || !name) {
      return json({ ok: false, success: false, error: 'nombre, email y password requeridos' }, 400);
    }

    if (!isValidEmail(email)) {
      return json({ ok: false, success: false, error: 'email inválido' }, 400);
    }

    if (password.length < 6) {
      return json({ ok: false, success: false, error: 'la contraseña debe tener al menos 6 caracteres' }, 400);
    }

    const supabase = createSupabaseServerClient(cookies);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: env.ASTRO_SITE || undefined,
        data: {
          name,
          role
        }
      }
    });

    if (error || !data.user) {
      return json({ ok: false, success: false, error: error?.message ?? 'no se pudo registrar' }, 400);
    }

    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from('user_profiles')
      .upsert(
        {
          id: data.user.id,
          email,
          name,
          role
        },
        { onConflict: 'id' }
      )
      .select('id,email,name,role,createdAt')
      .single();

    if (upsertError || !upserted) {
      return json({ ok: false, success: false, error: 'No se pudo guardar el perfil' }, 500);
    }

    return json(
      {
        ok: true,
        success: true,
        user: upserted,
        requiresEmailConfirmation: !data.session
      },
      200
    );
  } catch (error: unknown) {
    // Manejo de duplicados (email unique)
    if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === 'P2002') {
      console.warn('[register] email duplicado');
      return json({ ok: false, success: false, error: 'email ya registrado' }, 409);
    }
    const message = error instanceof Error ? error.message : 'Server error';
    console.error('[register] error', error);
    return json({ ok: false, success: false, error: message }, 500);
  }
};

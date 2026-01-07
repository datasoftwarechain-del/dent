import type { APIRoute } from 'astro';
import { Role } from '@/server/db/types';
import { supabaseAdmin } from '@/server/db/client';
import { requireRole } from '@/server/auth/session';

export const GET: APIRoute = async (context) => {
  const guard = await requireRole([Role.CLINIC_ADMIN, Role.TECHNICIAN])(context);
  if (guard) {
    return guard;
  }

  const { data: users = [], error } = await supabaseAdmin
    .from('user_profiles')
    .select('id,email,name,role,createdAt')
    .order('createdAt', { ascending: false })
    .limit(20);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: 'Error del servidor' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  return new Response(JSON.stringify({ ok: true, success: true, users }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
};

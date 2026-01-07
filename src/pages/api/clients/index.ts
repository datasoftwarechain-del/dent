import type { APIRoute } from 'astro';
import { z } from 'zod';
import { Role } from '@/server/db/types';
import { supabaseAdmin } from '@/server/db/client';
import { isAdmin } from '@/server/auth/permissions';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

const clientSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres')
});

const parseLimit = (raw: string | null) => {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 100);
};

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  if (!isAdmin(user)) {
    return json({ ok: false, error: 'Permiso insuficiente' }, 403);
  }

  const q = url.searchParams.get('q')?.trim();
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = url.searchParams.get('cursor') ?? undefined;

  let query = supabaseAdmin
    .from('clients')
    .select('id,name,createdAt')
    .order('name', { ascending: true })
    .limit(limit + 1);

  if (q) {
    query = query.ilike('name', `%${q}%`);
  }

  if (cursor) {
    query = query.gt('id', cursor);
  }

  const { data: clients = [], error } = await query;

  if (error) {
    return json({ ok: false, error: 'Error del servidor' }, 500);
  }

  let nextCursor: string | null = null;
  if (clients.length > limit) {
    const nextItem = clients.pop();
    nextCursor = nextItem?.id ?? null;
  }

  return json({ ok: true, data: clients, nextCursor });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;

  if (!user || user.role !== Role.CLINIC_ADMIN) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  const body = await request.json();
  const parsed = clientSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .insert({ name: parsed.data.name })
    .select('*')
    .single();

  if (error || !client) {
    return new Response(JSON.stringify({ error: 'Error del servidor' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  return new Response(JSON.stringify(client), {
    status: 201,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
};

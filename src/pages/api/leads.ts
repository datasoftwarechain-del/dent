import type { APIRoute } from 'astro';
import { z } from 'zod';
import { supabaseAdmin } from '@/server/db/client';
import { isAdmin } from '@/server/auth/permissions';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

const leadSchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  email: z.string().email('Email inválido'),
  phone: z.string().optional(),
  message: z.string().optional(),
  source: z.string().optional()
});

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }
  if (!isAdmin(locals.user)) {
    return json({ ok: false, error: 'Permiso insuficiente' }, 403);
  }

  const { data: leads, error } = await supabaseAdmin
    .from('leads')
    .select('*')
    .order('createdAt', { ascending: false });

  if (error) {
    return json({ ok: false, error: 'Error del servidor' }, 500);
  }

  return json({ ok: true, data: leads ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.json();
    const lead = leadSchema.parse(payload);

    const { data: created, error } = await supabaseAdmin
      .from('leads')
      .insert({
        name: lead.name,
        email: lead.email,
        phone: lead.phone ?? null,
        message: lead.message ?? null,
        source: lead.source ?? null
      })
      .select('*')
      .single();

    if (error || !created) {
      return json({ ok: false, error: 'Error del servidor' }, 500);
    }

    return json({ ok: true, data: created }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(
        {
          ok: false,
          error: 'Datos inválidos',
          issues: error.errors?.map((issue) => ({
            path: issue.path,
            message: issue.message
          }))
        },
        400
      );
    }
    console.error('[leads][POST]', error);
    return json({ ok: false, error: 'Error del servidor' }, 500);
  }
};

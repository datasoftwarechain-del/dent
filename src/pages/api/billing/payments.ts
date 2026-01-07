import type { APIRoute } from 'astro';
import { recordPayment } from '@/server/services/billing-service';
import { isAdmin } from '@/server/auth/permissions';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  if (!isAdmin(locals.user)) {
    return json({ ok: false, error: 'Permiso insuficiente' }, 403);
  }

  try {
    const payload = await request.json();
    const clientId = typeof payload?.clientId === 'string' ? payload.clientId : null;
    const amount = payload?.amount;
    const date = payload?.date;
    const note = typeof payload?.note === 'string' && payload.note.length ? payload.note : undefined;

    if (!clientId || amount === undefined || amount === null) {
      return json({ ok: false, error: 'clientId y amount son requeridos' }, 400);
    }

    const payments = await recordPayment({
      clientId,
      amount,
      date,
      note
    });

    return json({ ok: true, data: payments });
  } catch (error) {
    console.error('[billing/payments][POST] error', error);
    const message = error instanceof Error ? error.message : 'Error del servidor';
    return json({ ok: false, error: message }, 400);
  }
};

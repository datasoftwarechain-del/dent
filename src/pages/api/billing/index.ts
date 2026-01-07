import type { APIRoute } from 'astro';
import { isAdmin } from '@/server/auth/permissions';
import { getStatementByClient, createInvoiceFromOrder } from '@/server/services/billing-service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  if (!isAdmin(user)) {
    return json({ ok: false, error: 'Permiso insuficiente' }, 403);
  }

  const clientId = url.searchParams.get('clientId');
  if (!clientId) {
    return json({ ok: false, error: 'clientId es requerido' }, 400);
  }

  try {
    const data = await getStatementByClient(clientId);
    return json({ ok: true, data });
  } catch (error) {
    console.error('[billing][GET]', error);
    const message = error instanceof Error ? error.message : 'Error al obtener el estado de cuenta';
    return json({ ok: false, error: message }, 400);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  if (!isAdmin(user)) {
    return json({ ok: false, error: 'Permiso insuficiente' }, 403);
  }

  try {
    const payload = await request.json();
    const orderId = typeof payload?.orderId === 'string' ? payload.orderId : null;
    if (!orderId) {
      return json({ ok: false, error: 'orderId es requerido' }, 400);
    }

    const invoice = await createInvoiceFromOrder(orderId);
    return json({ ok: true, data: invoice }, 201);
  } catch (error) {
    console.error('[billing][POST]', error);
    const message = error instanceof Error ? error.message : 'No se pudo generar la factura';
    return json({ ok: false, error: message }, 400);
  }
};

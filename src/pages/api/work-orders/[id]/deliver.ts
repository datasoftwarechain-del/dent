import type { APIRoute } from 'astro';
import { isAdmin } from '@/server/auth/permissions';
import { markOrderAsDelivered } from '@/server/services/invoicing-service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  if (!isAdmin(user)) {
    return json({ ok: false, error: 'Permiso insuficiente' }, 403);
  }

  const orderId = params.id;
  if (!orderId || typeof orderId !== 'string') {
    return json({ ok: false, error: 'orderId es requerido' }, 400);
  }

  try {
    const result = await markOrderAsDelivered(orderId, {
      id: user.id,
      role: user.role,
      email: user.email ?? null
    });

    return json({ ok: true, ...result }, 200);
  } catch (error) {
    console.error('[work-orders][deliver][POST] error', error);
    const message =
      error instanceof Error ? error.message : 'No se pudo marcar la orden como entregada';
    return json({ ok: false, error: message }, 400);
  }
};


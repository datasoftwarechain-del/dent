import type { APIRoute } from 'astro';
import { addItemToCart, clearCart, getCart } from '@/server/services';
import { json, parseJson, withErrorHandling } from '@/server/utils/http';

const ensureUser = (locals: App.Locals) => {
  if (!locals.user) {
    return null;
  }

  return locals.user;
};

export const GET: APIRoute = withErrorHandling(async ({ locals }) => {
  const user = ensureUser(locals);
  if (!user) {
    return json({ success: false, error: 'No autenticado' }, { status: 401 });
  }
  const cart = await getCart(user.id);

  return json({ success: true, cart });
});

export const POST: APIRoute = withErrorHandling(async ({ locals, request }) => {
  const user = ensureUser(locals);
  if (!user) {
    return json({ success: false, error: 'No autenticado' }, { status: 401 });
  }
  const payload = await parseJson<{ productId: string; qty: number }>(request);
  const result = await addItemToCart(user.id, payload);

  return json({ success: true, cart: result });
});

export const DELETE: APIRoute = withErrorHandling(async ({ locals }) => {
  const user = ensureUser(locals);
  if (!user) {
    return json({ success: false, error: 'No autenticado' }, { status: 401 });
  }
  await clearCart(user.id);

  return json({ success: true });
});

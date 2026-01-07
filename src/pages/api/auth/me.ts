import type { APIRoute } from 'astro';
export const GET: APIRoute = async ({ locals }) => {
  return new Response(JSON.stringify({ ok: true, user: locals.user }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

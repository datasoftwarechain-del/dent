import type { APIRoute } from 'astro';
import { json } from '@/server/utils/http';

export const GET: APIRoute = () => {
  return json({ ok: true });
};

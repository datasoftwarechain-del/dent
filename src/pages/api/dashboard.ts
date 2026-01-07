import 'dotenv/config';
import type { APIRoute } from 'astro';
import { json } from '@/server/utils/http';
import { getDashboardSummary } from '@/server/services/dashboard-summary';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user?.id) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const summary = await getDashboardSummary({
      id: user.id,
      role: user.role
    });

    return json({ ok: true, ...summary }, { status: 200 });
  } catch (error) {
    console.error('[dashboard][GET]', error);
    return json({ ok: false, error: 'server_error' }, { status: 500 });
  }
};

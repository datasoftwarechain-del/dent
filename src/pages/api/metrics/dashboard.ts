import type { APIRoute } from 'astro';
import { getDashboardMetrics } from '@/server/services/metrics-service';
import { json } from '@/server/utils/http';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user?.id) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const metrics = await getDashboardMetrics({
      id: user.id,
      role: user.role,
      email: user.email ?? null
    });
    return json({ ok: true, metrics }, { status: 200 });
  } catch (error) {
    console.error('[metrics/dashboard] error', error);
    return json({ ok: false, error: 'Server error' }, { status: 500 });
  }
};

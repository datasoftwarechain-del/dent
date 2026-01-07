import 'dotenv/config';
import type { APIRoute } from 'astro';
import { json } from '@/server/utils/http';
import { getDueTomorrowWorkOrderNotifications } from '@/server/services/notifications-service';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user?.id) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const clinicId =
    typeof user === 'object' && user && 'clinicId' in user ? (user.clinicId as string | null | undefined) : undefined;
  const labId =
    typeof user === 'object' && user && 'labId' in user ? (user.labId as string | null | undefined) : undefined;
  const clientId =
    typeof user === 'object' && user && 'clientId' in user ? (user.clientId as string | null | undefined) : undefined;

  try {
    const notifications = await getDueTomorrowWorkOrderNotifications({
      id: user.id,
      role: user.role,
      clinicId,
      labId,
      clientId
    });
    return json({ ok: true, notifications }, { status: 200 });
  } catch (error) {
    console.error('[notifications][GET]', error);
    return json({ ok: false, error: 'server_error' }, { status: 500 });
  }
};

import type { APIRoute } from 'astro';
import { Role } from '@/server/db/types';
import { fetchCalendarEvents, type CalendarRange } from '@/server/services/calendar-service';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

const normalizeRange = (range: CalendarRange, fromISO: string | null) => {
  const reference = fromISO ? new Date(fromISO) : new Date();
  if (Number.isNaN(reference.getTime())) {
    throw new Error('Fecha inválida');
  }

  if (range === 'week') {
    const start = startOfDay(reference);
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const weekStart = addDays(start, diffToMonday);
    const weekEnd = addDays(weekStart, 7);
    return { rangeStart: weekStart, rangeEnd: weekEnd };
  }

  const monthStart = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const monthEnd = addMonths(monthStart, 1);
  return { rangeStart: monthStart, rangeEnd: monthEnd };
};

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  const rangeParam = (url.searchParams.get('range') ?? 'week') as CalendarRange;
  if (!['week', 'month'].includes(rangeParam)) {
    return json({ ok: false, error: 'Rango inválido' }, 400);
  }

  try {
    const { rangeStart, rangeEnd } = normalizeRange(rangeParam, url.searchParams.get('from'));

    const events = await fetchCalendarEvents({
      user: {
        id: user.id,
        role: user.role as Role,
        clinicId: user.clinicId ?? null,
        labId: user.labId ?? null,
        clientId: user.clientId ?? null
      },
      rangeStart,
      rangeEnd
    });

    const days: string[] = [];
    for (let cursor = new Date(rangeStart); cursor < rangeEnd; cursor = addDays(cursor, 1)) {
      days.push(cursor.toISOString());
    }

    const items = events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
      status: event.status ?? null,
      patientName: event.patientName ?? null,
      clientName: event.clientName ?? null,
      workType: event.metadata?.workType ?? null
    }));

    return json({ ok: true, data: { events: items } });
  } catch (error) {
    console.error('[calendar][GET]', error);
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return json({ ok: false, error: message }, 400);
  }
};

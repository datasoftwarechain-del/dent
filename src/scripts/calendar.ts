import { Calendar } from 'fullcalendar';

type CalendarEventDto = {
  id: string;
  type: 'APPOINTMENT' | 'WORK_ORDER';
  title: string | null;
  start: string | null;
  end: string | null;
  status: string | null;
  patient: string | null;
  client: string | null;
  workType: string | null;
  deliveryDate?: string | null;
  metadata?: Record<string, unknown> | null;
};

type CalendarData = {
  events: CalendarEventDto[];
};

type FullCalendarEventInput = {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  extendedProps: Record<string, unknown>;
};

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  issues?: Array<{ path?: unknown; message?: string }>;
};

const apiFetch = async <T>(url: string, options?: RequestInit) => {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
    ...options
  });
  const body = (await res.json()) as ApiResponse<T> & Record<string, unknown>;
  if (!res.ok || !body.ok) {
    const errorMessage =
      body.error ??
      body.issues?.[0]?.message ??
      `Error inesperado (${res.status})`;
    throw new Error(errorMessage);
  }
  if ('data' in body && body.data !== undefined) {
    return body.data as T;
  }
  const { ok, error, issues, ...rest } = body;
  return rest as unknown as T;
};

const toFullCalendarEvents = (items: CalendarEventDto[]): FullCalendarEventInput[] => {
  if (!items || items.length === 0) {
    return [];
  }

  return items
    .map((item) => {
      if (!item) return null;

      const isWorkOrder = item.type === 'WORK_ORDER';
      const preferredDate = item.deliveryDate ?? null;
      const startISO = (isWorkOrder ? preferredDate ?? item.start : item.start) ?? null;
      if (!startISO) {
        return null;
      }

      const endISO = !isWorkOrder && item.end ? item.end : undefined;

      return {
        id: item.id,
        title: item.title ?? (isWorkOrder ? 'Orden' : 'Cita'),
        start: startISO,
        end: endISO,
        allDay: isWorkOrder,
        extendedProps: {
          ...item,
          start: startISO,
          end: endISO ?? null
        }
      };
    })
    .filter((event): event is FullCalendarEventInput => Boolean(event));
};

const fetchCalendarRange = async (range: 'week' | 'month', fromISO: string) => {
  const params = new URLSearchParams({
    range,
    from: fromISO
  });

  try {
    const data = await apiFetch<CalendarData>(`/api/calendar?${params.toString()}`);
    return toFullCalendarEvents(data.events ?? []);
  } catch (error) {
    console.error('[calendar] no se pudieron obtener eventos', error);
    return [];
  }
};

const initCalendar = () => {
  const weekViewButton = document.getElementById('week-view-button');
  const monthViewButton = document.getElementById('month-view-button');
  const calendarWeekEl = document.getElementById('calendar-week');
  const calendarMonthEl = document.getElementById('calendar-month');

  if (!calendarWeekEl || !calendarMonthEl || !weekViewButton || !monthViewButton) return;

  const weekCalendar = new Calendar(calendarWeekEl, {
    initialView: 'timeGridWeek',
    events: async (fetchInfo) => {
      return fetchCalendarRange('week', fetchInfo.start.toISOString());
    },
  });

  const monthCalendar = new Calendar(calendarMonthEl, {
    initialView: 'dayGridMonth',
    events: async (fetchInfo) => {
      return fetchCalendarRange('month', fetchInfo.start.toISOString());
    },
  });

  weekViewButton.addEventListener('click', () => {
    calendarMonthEl.classList.add('hidden');
    calendarWeekEl.classList.remove('hidden');
    weekCalendar.render();
  });

  monthViewButton.addEventListener('click', () => {
    calendarWeekEl.classList.add('hidden');
    calendarMonthEl.classList.remove('hidden');
    monthCalendar.render();
  });

  weekCalendar.render();
};

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCalendar, { once: true });
  } else {
    initCalendar();
  }
}

export {};

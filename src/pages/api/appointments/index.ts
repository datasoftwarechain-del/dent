import type { APIRoute } from 'astro';
import { z } from 'zod';
import { AppointmentStatus, Role } from '@/server/db/types';
import { supabaseAdmin } from '@/server/db/client';
import { json } from '@/server/utils/http';

type AppointmentRow = {
  id: string;
  patientId: string;
  dentistId: string;
  startsAt: string | Date;
  endsAt: string | Date;
  treatment?: string | null;
  notes?: string | null;
  status: AppointmentStatus | string;
  createdAt: string | Date;
  updatedAt: string | Date;
  patient?: { id: string; name: string } | null;
  dentist?: { id: string; name: string | null; email: string | null } | null;
};

const toDateString = (value: string | Date) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toDto = (appointment: AppointmentRow) => ({
  id: appointment.id,
  patientId: appointment.patientId,
  dentistId: appointment.dentistId,
  startsAt: toDateString(appointment.startsAt),
  endsAt: toDateString(appointment.endsAt),
  treatment: appointment.treatment ?? null,
  notes: appointment.notes ?? null,
  status: appointment.status,
  createdAt: toDateString(appointment.createdAt),
  updatedAt: toDateString(appointment.updatedAt),
  patient: appointment.patient
    ? {
        id: appointment.patient.id,
        name: appointment.patient.name
      }
    : null,
  dentist: appointment.dentist
    ? {
        id: appointment.dentist.id,
        name: appointment.dentist.name ?? null,
        email: appointment.dentist.email ?? null
      }
    : null
});

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato de mes inválido (YYYY-MM)');

const daySchema = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    'Formato de día inválido (YYYY-MM-DD)'
  );

const querySchema = z.object({
  month: monthSchema.optional(),
  day: daySchema.optional(),
  q: z
    .string()
    .trim()
    .min(1, 'Búsqueda muy corta')
    .max(200, 'Búsqueda muy larga')
    .optional(),
  dentistId: z.string().uuid().optional()
});

const createSchema = z
  .object({
    patientId: z.string().uuid({ message: 'Paciente inválido' }),
    dentistId: z.string().uuid({ message: 'Odontólogo inválido' }),
    startsAt: z.string().datetime({ message: 'Fecha de inicio inválida' }),
    endsAt: z.string().datetime({ message: 'Fecha de fin inválida' }),
    treatment: z
      .string()
      .trim()
      .max(200, 'Tratamiento muy largo')
      .optional(),
    notes: z
      .string()
      .trim()
      .max(1000, 'Notas demasiado largas')
      .optional(),
    status: z.nativeEnum(AppointmentStatus).optional()
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startsAt);
    const end = new Date(data.endsAt);
    if (!(end > start)) {
      ctx.addIssue({
        path: ['endsAt'],
        code: z.ZodIssueCode.custom,
        message: 'La finalización debe ser posterior al inicio'
      });
    }
  });

const rangeForMonth = (value: string) => {
  const [yearStr, monthStr] = value.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
  return { start, end };
};

const rangeForDay = (value: string) => {
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  const start = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex, day + 1, 0, 0, 0, 0));
  return { start, end };
};

type UserContext = {
  id?: string;
  role?: string | null;
};

const ensureDentistScope = (user: UserContext | null | undefined, requested?: string | null) => {
  if (!user) return undefined;
  if (user.role === Role.DENTIST) return user.id;
  if (requested && requested.length > 0) return requested;
  return undefined;
};

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user?.id) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const rawQ = url.searchParams.get('q') ?? undefined;
  const rawFilters = {
    month: url.searchParams.get('month') ?? undefined,
    day: url.searchParams.get('day') ?? undefined,
    q: rawQ && rawQ.trim().length > 0 ? rawQ : undefined,
    dentistId: url.searchParams.get('dentistId') ?? undefined
  };

  const parsed = querySchema.safeParse(rawFilters);
  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: 'invalid_query',
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }

  const scopeDentistId = ensureDentistScope(user, parsed.data.dentistId);

  let patientIds: string[] | undefined;
  if (parsed.data.q) {
    const { data: patients, error: patientError } = await supabaseAdmin
      .from('patients')
      .select('id')
      .ilike('name', `%${parsed.data.q}%`)
      .limit(50);

    if (patientError) {
      return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
    }

    patientIds = (patients ?? []).map((patient) => patient.id);
    if (!patientIds.length) {
      return json({ ok: true, data: [] });
    }
  }

  let query = supabaseAdmin
    .from('appointments')
    .select('id,patientId,dentistId,startsAt,endsAt,treatment,notes,status,createdAt,updatedAt,patient:patientId(id,name),dentist:dentistId(id,name,email)')
    .order('startsAt', { ascending: true });

  if (scopeDentistId) {
    query = query.eq('dentistId', scopeDentistId);
  }

  if (patientIds) {
    query = query.in('patientId', patientIds);
  }

  const hasDay = !!parsed.data.day;
  const hasMonth = !!parsed.data.month || !parsed.data.day;

  if (hasDay && parsed.data.day) {
    const { start, end } = rangeForDay(parsed.data.day);
    query = query.gte('startsAt', start.toISOString()).lt('startsAt', end.toISOString());
  } else if (hasMonth) {
    const monthValue =
      parsed.data.month ??
      (() => {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
      })();
    const { start, end } = rangeForMonth(monthValue);
    query = query.gte('startsAt', start.toISOString()).lt('startsAt', end.toISOString());
  }

  const { data: appointments, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
  }

  return json({ ok: true, data: (appointments ?? []).map(toDto) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user?.id) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: 'validation_error',
        issues: parsed.error.issues
      },
      { status: 400 }
    );
  }

  const { data: created, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      patientId: parsed.data.patientId,
      dentistId: parsed.data.dentistId,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      treatment: parsed.data.treatment ?? null,
      notes: parsed.data.notes ?? null,
      status: parsed.data.status ?? AppointmentStatus.SCHEDULED
    })
    .select('id,patientId,dentistId,startsAt,endsAt,treatment,notes,status,createdAt,updatedAt,patient:patientId(id,name),dentist:dentistId(id,name,email)')
    .single();

  if (error || !created) {
    return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
  }

  return json({ ok: true, data: toDto(created) }, { status: 201 });
};

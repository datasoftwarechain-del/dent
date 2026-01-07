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

const idSchema = z.string().uuid({ message: 'Identificador inválido' });

const updateSchema = z
  .object({
    patientId: z.string().uuid().optional(),
    dentistId: z.string().uuid().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    treatment: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(1000).optional(),
    status: z.nativeEnum(AppointmentStatus).optional()
  })
  .superRefine((data, ctx) => {
    if (data.startsAt && data.endsAt) {
      const start = new Date(data.startsAt);
      const end = new Date(data.endsAt);
      if (!(end > start)) {
        ctx.addIssue({
          path: ['endsAt'],
          code: z.ZodIssueCode.custom,
          message: 'La finalización debe ser posterior al inicio'
        });
      }
    }
  });

type UserContext = {
  id?: string;
  role?: string | null;
};

const ensureCanAccess = (user: UserContext | undefined | null, appointment: AppointmentRow) => {
  if (!user) return false;
  if (user.role === Role.DENTIST && appointment.dentistId !== user.id) {
    return false;
  }
  return true;
};

const trimOptional = (value?: string | null) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const baseSelect =
  'id,patientId,dentistId,startsAt,endsAt,treatment,notes,status,createdAt,updatedAt,patient:patientId(id,name),dentist:dentistId(id,name,email)';

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user?.id) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const parsedId = idSchema.safeParse(params.id);
  if (!parsedId.success) {
    return json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select(baseSelect)
    .eq('id', parsedId.data)
    .single();

  if (error) {
    return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
  }

  if (!appointment) {
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  if (!ensureCanAccess(user, appointment)) {
    return json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  return json({ ok: true, data: toDto(appointment) }, { status: 200 });
};

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user?.id) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const parsedId = idSchema.safeParse(params.id);
  if (!parsedId.success) {
    return json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }

  const { data: appointment, error: loadError } = await supabaseAdmin
    .from('appointments')
    .select(baseSelect)
    .eq('id', parsedId.data)
    .single();

  if (loadError) {
    return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
  }

  if (!appointment) {
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  if (!ensureCanAccess(user, appointment)) {
    return json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  try {
    const payload = await request.json();
    const parsed = updateSchema.safeParse(payload ?? {});

    if (!parsed.success) {
      return json(
        { ok: false, error: 'invalid_body', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const data = parsed.data;

    if (data.dentistId && user.role === Role.DENTIST && data.dentistId !== user.id) {
      return json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const currentStart = data.startsAt ? new Date(data.startsAt) : new Date(appointment.startsAt);
    const currentEnd = data.endsAt ? new Date(data.endsAt) : new Date(appointment.endsAt);

    if (!(currentEnd > currentStart)) {
      return json(
        {
          ok: false,
          error: 'invalid_range',
          issues: [{ path: ['endsAt'], message: 'La finalización debe ser posterior al inicio' }]
        },
        { status: 400 }
      );
    }

    const treatmentValue =
      data.treatment !== undefined ? trimOptional(data.treatment) ?? null : undefined;
    const notesValue = data.notes !== undefined ? trimOptional(data.notes) ?? null : undefined;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('appointments')
      .update({
        patientId: data.patientId ?? undefined,
        dentistId: data.dentistId ?? undefined,
        startsAt: data.startsAt ?? undefined,
        endsAt: data.endsAt ?? undefined,
        treatment: treatmentValue,
        notes: notesValue,
        status: data.status ?? undefined
      })
      .eq('id', appointment.id)
      .select(baseSelect)
      .single();

    if (updateError || !updated) {
      return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
    }

    return json({ ok: true, data: toDto(updated) }, { status: 200 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user?.id) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const parsedId = idSchema.safeParse(params.id);
  if (!parsedId.success) {
    return json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select(baseSelect)
    .eq('id', parsedId.data)
    .single();

  if (error) {
    return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
  }

  if (!appointment) {
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  if (!ensureCanAccess(user, appointment)) {
    return json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const { error: deleteError } = await supabaseAdmin
    .from('appointments')
    .delete()
    .eq('id', parsedId.data);

  if (deleteError) {
    return json({ ok: false, error: 'Error del servidor' }, { status: 500 });
  }

  return json({ ok: true }, { status: 200 });
};

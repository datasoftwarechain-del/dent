import { z } from 'zod';
import { supabaseAdmin } from '../db/client';

const appointmentSchema = z.object({
  dentistId: z.string().min(1),
  title: z.string().min(1),
  start: z.coerce.date(),
  end: z.coerce.date(),
  location: z.string().optional(),
  notes: z.string().optional()
});

export type AppointmentPayload = z.infer<typeof appointmentSchema>;

export const createAppointment = async (payload: AppointmentPayload) => {
  const data = appointmentSchema.parse(payload);

  if (data.end <= data.start) {
    throw new Error('La fecha de fin debe ser posterior al inicio');
  }

  const { data: created, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      dentistId: data.dentistId,
      treatment: data.title,
      startsAt: data.start,
      endsAt: data.end,
      notes: data.notes ?? null,
      location: data.location ?? null
    })
    .select('*')
    .single();

  if (error) {
    throw new Error('No se pudo crear la cita');
  }

  return created;
};

export const listAppointments = async (dentistId: string, range?: { start: Date; end: Date }) => {
  let query = supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('dentistId', dentistId)
    .order('startsAt', { ascending: true });

  if (range) {
    query = query.gte('startsAt', range.start.toISOString()).lte('endsAt', range.end.toISOString());
  }

  const { data: appointments, error } = await query;

  if (error) {
    throw new Error('No se pudieron obtener las citas');
  }

  return appointments ?? [];
};

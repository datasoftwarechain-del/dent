import { z } from 'zod';
import { supabaseAdmin } from '../db/client';

const patientSchema = z.object({
  ownerUserId: z.string().min(1),
  name: z.string().min(1),
  birthdate: z.coerce.date().optional(),
  notes: z.string().max(5000).optional()
});

export type PatientPayload = z.infer<typeof patientSchema>;

export const createPatient = async (payload: PatientPayload) => {
  const data = patientSchema.parse(payload);

  const { data: created, error } = await supabaseAdmin
    .from('patients')
    .insert(data)
    .select('*')
    .single();

  if (error) {
    throw new Error('No se pudo crear el paciente');
  }

  return created;
};

export const updatePatient = async (id: string, payload: Partial<PatientPayload>) => {
  const data = patientSchema.partial().parse(payload);

  const { data: updated, error } = await supabaseAdmin
    .from('patients')
    .update(data)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error('No se pudo actualizar el paciente');
  }

  return updated;
};

export const listPatients = async (ownerUserId: string) => {
  const { data: patients, error } = await supabaseAdmin
    .from('patients')
    .select('*')
    .eq('ownerUserId', ownerUserId)
    .order('name', { ascending: true });

  if (error) {
    throw new Error('No se pudieron cargar pacientes');
  }

  return patients ?? [];
};

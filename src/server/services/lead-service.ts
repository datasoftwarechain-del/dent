import { z } from 'zod';
import { sendEmail } from '../notifications/email';
import { logger } from '../logger';
import { supabaseAdmin } from '@/server/db/client';

const leadSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  organization: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  message: z.string().max(2000).optional()
});

export type LeadInput = z.infer<typeof leadSchema>;

export const createLead = async (input: LeadInput) => {
  const data = leadSchema.parse(input);

  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .insert({
      name: data.fullName,
      email: data.email,
      phone: data.phone ?? null,
      message: data.message ?? null,
      source: data.organization ?? null
    })
    .select('*')
    .single();

  if (error || !lead) {
    throw new Error('No se pudo guardar el lead');
  }

  try {
    await sendEmail({
      to: 'ventas@digitaldent.app',
      subject: 'Nuevo lead desde la landing de DigitalDent',
      text: `Nombre: ${lead.name}\nEmail: ${lead.email}\nEmpresa: ${data.organization ?? 'N/A'}\nTeléfono: ${lead.phone ?? 'N/A'}\nMensaje: ${lead.message ?? 'N/A'}`
    });
  } catch (error) {
    logger.warn({ error }, 'No se pudo enviar el correo de lead');
  }

  return lead;
};

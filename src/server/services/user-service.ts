import { Role } from '@/server/db/types';
import { z } from 'zod';
import { supabaseAdmin } from '../db/client';
import { getSupabaseAdminClient } from '../supabase';

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role).default(Role.CLIENT)
});

export type RegisterUserInput = z.infer<typeof registerSchema>;

export const registerUser = async (payload: RegisterUserInput) => {
  const data = registerSchema.parse(payload);

  const admin = getSupabaseAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { name: data.name, role: data.role }
  });

  if (error || !created.user) {
    throw new Error(error?.message ?? 'No se pudo crear el usuario');
  }

  const { data: user, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .insert({
      id: created.user.id,
      name: data.name,
      email: data.email,
      role: data.role
    })
    .select('*')
    .single();

  if (profileError || !user) {
    throw new Error('No se pudo crear el perfil');
  }

  return { user };
};

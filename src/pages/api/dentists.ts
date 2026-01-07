import type { APIRoute } from "astro";
import { z } from "zod";
import { Role } from "@/server/db/types";
import { supabaseAdmin } from "@/server/db/client";
import { getSupabaseAdminClient } from "@/server/supabase";

const dentistSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
  email: z.string().email("El email no es válido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

export const post: APIRoute = async ({ request, locals }) => {
  const user = locals.user;

  if (!user || user.role !== Role.CLINIC_ADMIN) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const parsed = dentistSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { name: parsed.data.name, role: Role.DENTIST }
  });

  if (error || !data.user) {
    return new Response(JSON.stringify({ error: error?.message ?? "No se pudo crear el usuario" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: dentist, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .insert({
      id: data.user.id,
      name: parsed.data.name,
      email: parsed.data.email,
      role: Role.DENTIST,
      clinicId: user.clinicId ?? null
    })
    .select("*")
    .single();

  if (profileError || !dentist) {
    return new Response(JSON.stringify({ error: "No se pudo crear el perfil" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(dentist), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};

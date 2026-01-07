import type { APIRoute } from "astro";
import { z } from "zod";
import { Role } from "@/server/db/types";
import { supabaseAdmin } from "@/server/db/client";

const labSchema = z.object({
  name: z.string().min(3, "El nombre debe tener al menos 3 caracteres"),
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
  const parsed = labSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: lab, error } = await supabaseAdmin
    .from("labs")
    .insert({ name: parsed.data.name })
    .select("*")
    .single();

  if (error || !lab) {
    return new Response(JSON.stringify({ error: "No se pudo crear el laboratorio" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(lab), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
};

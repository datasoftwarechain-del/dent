import type { APIRoute } from 'astro';
import { ZodError, z } from 'zod';
import {
  listWorkOrders,
  createWorkOrder,
  type ListWorkOrdersInput,
  type CreateWorkOrderInput
} from '@/server/services/work-order-service';
import {
  WorkOrderCreateInput,
  canCreateWorkOrder,
  normalizeWorkType
} from '@/server/auth/permissions';
import { supabaseAdmin } from '@/server/db/client';

const json = (res: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(res), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {})
    }
  });

export type BodyReadResult =
  | { type: 'json' | 'unknown'; body: Record<string, unknown> }
  | { type: 'form'; body: Record<string, unknown>; formData: FormData };

export async function readBodyUniversal(request: Request): Promise<BodyReadResult> {
  const contentType = request.headers.get('content-type') || '';
  const lowered = contentType.toLowerCase();

  if (lowered.includes('application/json')) {
    const data = await request.json();
    return {
      type: 'json',
      body: (data && typeof data === 'object' ? (data as Record<string, unknown>) : {}) ?? {}
    };
  }

  if (
    lowered.includes('application/x-www-form-urlencoded') ||
    lowered.includes('multipart/form-data')
  ) {
    const formData = await request.formData();
    const accumulator: Record<string, unknown> = {};

    for (const [key, value] of formData.entries()) {
      const normalizedValue =
        typeof value === 'string'
          ? value
          : typeof value === 'object' && value !== null && 'name' in value
            ? String((value as unknown as { name?: string }).name ?? '')
            : '';

      if (accumulator[key] === undefined) {
        accumulator[key] = normalizedValue;
        continue;
      }

      const existing = accumulator[key];
      if (Array.isArray(existing)) {
        existing.push(normalizedValue);
      } else {
        accumulator[key] = [existing, normalizedValue];
      }
    }

    return { type: 'form', body: accumulator, formData };
  }

  try {
    const fallback = await request.json();
    return {
      type: 'json',
      body:
        (fallback && typeof fallback === 'object'
          ? (fallback as Record<string, unknown>)
          : {}) ?? {}
    };
  } catch {
    return { type: 'unknown', body: {} };
  }
}

export const isFormRequest = (request: Request) => {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    return true;
  }
  const accept = request.headers.get('accept')?.toLowerCase() ?? '';
  return accept.includes('text/html');
};

export const pickAlias = (raw: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
      continue;
    }
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

export const normalizeAliases = (raw: Record<string, unknown>) => {
  const normalized: Record<string, unknown> = { ...raw };

  const patientId = pickAlias(raw, 'patientId', 'patient_id', 'patient-id', 'patient');
  if (patientId !== undefined) normalized.patientId = patientId;

  const dentistId = pickAlias(raw, 'dentistId', 'dentist_id', 'dentist-id', 'dentist');
  if (dentistId !== undefined) normalized.dentistId = dentistId;

  const dueDate = pickAlias(raw, 'dueDate', 'due_date', 'due-date', 'dueDateTime');
  if (dueDate !== undefined) normalized.dueDate = dueDate;

  const clientId = pickAlias(raw, 'clientId', 'client_id', 'client-id', 'client');
  if (clientId !== undefined) normalized.clientId = clientId;

  return normalized;
};

export const toStringTrim = (value: unknown) => String(value ?? '').trim();
const uuidSchema = z.string().uuid();

const issueFieldName = (path: (string | number)[]) => {
  if (!path.length) return 'dato';
  const last = path[path.length - 1];
  return typeof last === 'string' ? last : path.join('.');
};

export const mapIssueToSpanish = (issue: z.ZodIssue) => {
  const field = issueFieldName(issue.path);

  if (issue.code === 'invalid_type' && issue.message === 'Required') {
    return `${field} es requerido`;
  }

  if (issue.code === 'invalid_string' && issue.validation === 'uuid') {
    return `${field} debe ser un UUID válido`;
  }

  if (issue.code === 'invalid_date') {
    return `${field} debe ser una fecha válida`;
  }

  if (issue.code === 'invalid_string' && issue.validation === 'email') {
    return `${field} debe ser un email válido`;
  }

  if (issue.code === 'too_big' && issue.type === 'string') {
    return `${field} supera el largo permitido`;
  }

  if (issue.code === 'too_small' && issue.type === 'string') {
    return `${field} no alcanza el mínimo requerido`;
  }

  return issue.message;
};

export const optionalUuid = (raw: unknown, field: string) => {
  const value = toStringTrim(raw);
  if (!value) return undefined;
  if (!uuidSchema.safeParse(value).success) {
    throw new ZodError([
      { path: [field], message: `${field} debe ser un UUID válido`, code: 'custom' }
    ]);
  }
  return value;
};

export const GET: APIRoute = async ({ url, locals }) => {
  try {
    if (!locals.user?.id) return json({ ok: false, error: 'No autorizado' }, { status: 401 });

    const searchParams = url.searchParams;
    const valueOrUndefined = (key: string) => {
      const value = searchParams.get(key);
      return value && value.length > 0 ? value : undefined;
    };

    const statusValue = valueOrUndefined('status');
    const allowedSorts = new Set([
      'createdAt_asc',
      'createdAt_desc',
      'client_asc',
      'client_desc',
      'updatedAt_desc',
      'code_asc',
      'code_desc',
      'number_asc',
      'number_desc'
    ]);
    const sortParam = searchParams.get('sort');
    const sort = sortParam && allowedSorts.has(sortParam) ? sortParam : undefined;
    const limitRaw = searchParams.get('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
    const take =
      Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;
    const pageRaw = searchParams.get('page');
    const parsedPage = pageRaw ? Number.parseInt(pageRaw, 10) : NaN;
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const skip = (page - 1) * take;

    const filters: Partial<ListWorkOrdersInput> = {
      clientId: valueOrUndefined('clientId'),
      status: statusValue as ListWorkOrdersInput['status'],
      search: valueOrUndefined('search'),
      take,
      skip,
      sort: sort as ListWorkOrdersInput['sort']
    };

    const out = await listWorkOrders(filters, {
      id: locals.user.id,
      role: locals.user.role,
      email: locals.user.email
    });

    return json({ ok: true, ...out }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return json(
        {
          ok: false,
          error: 'Parámetros inválidos',
          issues: error.errors?.map((issue) => ({
            path: issue.path,
            message: mapIssueToSpanish(issue)
          }))
        },
        { status: 400 }
      );
    }
    console.error('[work-orders][GET] error', error);
    const message = error instanceof Error ? error.message : 'Error del servidor';
    return json({ ok: false, error: message }, { status: 500 });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const formSubmission = isFormRequest(request);

  const redirectWithError = (message: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: `/app/work-orders/new?error=${encodeURIComponent(message)}`
      }
    });

  try {
    const bodyResult = await readBodyUniversal(request);
    const rawPayload = bodyResult.body;
    const payload = normalizeAliases(rawPayload);

    if (
      payload.patient &&
      typeof payload.patient === 'object' &&
      payload.patient !== null
    ) {
      const nested = payload.patient as Record<string, unknown>;
      const nestedId = pickAlias(nested, 'id', 'patientId', 'patient_id');
      if (nestedId !== undefined) {
        payload.patientId = nestedId;
      }
    }

    const sessionDentistId = locals.user?.id ?? undefined;
    const currentUser = locals.user ?? null;

    if (sessionDentistId && !payload.dentistId) {
      payload.dentistId = sessionDentistId;
    }

    if (!payload.dentistId && !sessionDentistId) {
      return json({ ok: false, error: 'No autorizado' }, { status: 401 });
    }

    if (currentUser && !canCreateWorkOrder(currentUser)) {
      return json({ ok: false, error: 'Sin permisos' }, { status: 403 });
    }

    const resolvePatientId = async (value: unknown) => {
      const raw = toStringTrim(value);
      if (!raw) {
        throw new ZodError([{ path: ['patientId'], message: 'Paciente requerido', code: 'custom' }]);
      }

      if (uuidSchema.safeParse(raw).success) {
        return raw;
      }

      const { data: existing } = await supabaseAdmin
        .from('patients')
        .select('id')
        .eq('name', raw)
        .maybeSingle();
      if (existing) return existing.id;

      const { data: created, error } = await supabaseAdmin
        .from('patients')
        .insert({ name: raw })
        .select('id')
        .single();
      if (error || !created) {
        throw new Error('No se pudo crear el paciente');
      }
      return created.id;
    };

    const patientId = await resolvePatientId(payload.patientId);
    payload.patientId = patientId;

    const workTypeProvided =
      payload.workType !== undefined &&
      payload.workType !== null &&
      (Array.isArray(payload.workType)
        ? payload.workType.length > 0
        : String(payload.workType).trim().length > 0);

    const normalizedWorkType = normalizeWorkType(payload.workType);
    if (workTypeProvided && !normalizedWorkType) {
      throw new ZodError([
        { path: ['workType'], message: 'Tipo de trabajo inválido', code: 'custom' }
      ]);
    }

    const notes = toStringTrim(payload.notes);

    const dentistIdRaw = optionalUuid(payload.dentistId, 'dentistId');

    let finalClientId = optionalUuid(payload.clientId, 'clientId');

    if (!finalClientId && payload.predefinedClientName) {
      const predefinedClientName = String(payload.predefinedClientName).trim();
      if (predefinedClientName) {
        const { data: existingClient } = await supabaseAdmin
          .from('clients')
          .select('id')
          .eq('name', predefinedClientName)
          .maybeSingle();

        if (existingClient) {
          finalClientId = existingClient.id;
        } else {
          const { data: createdClient, error } = await supabaseAdmin
            .from('clients')
            .insert({ name: predefinedClientName })
            .select('id')
            .single();
          if (error || !createdClient) {
            throw new Error('No se pudo crear el cliente');
          }
          finalClientId = createdClient.id;
        }
      }
    }

    const baseInput = WorkOrderCreateInput.parse({
      dentistId: dentistIdRaw,
      patientId,
      clientId: finalClientId,
      dueDate: payload.dueDate ? String(payload.dueDate) : undefined,
      notes: notes || undefined,
      workType: normalizedWorkType ?? undefined
    });

    const files = Array.isArray(payload.files)
      ? (payload.files as CreateWorkOrderInput['files'])
      : undefined;

    const createPayload: CreateWorkOrderInput = {
      ...baseInput,
      ...(files ? { files } : {})
    };

    const created = await createWorkOrder(
      createPayload,
      currentUser
        ? { id: currentUser.id, role: currentUser.role, email: currentUser.email ?? undefined }
        : undefined
    );

    if (formSubmission) {
      const location =
        '/app/work-orders' + (created.id ? `?created=${encodeURIComponent(created.id)}` : '');
      return new Response(null, {
        status: 303,
        headers: {
          Location: location
        }
      });
    }

    return json({ ok: true, data: created }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const issues =
        error.errors?.map((issue) => ({
          path: issue.path,
          message: mapIssueToSpanish(issue)
        })) ?? [];

      const message = issues[0]?.message ?? 'Datos inválidos';

      if (formSubmission) {
        return redirectWithError(message);
      }

      return json(
        {
          ok: false,
          error: message,
          issues
        },
        { status: 400 }
      );
    }

    console.error('[work-orders][POST] error', error);
    const message = error instanceof Error ? error.message : 'Error del servidor';

    if (formSubmission) {
      return redirectWithError(message);
    }

    return json({ ok: false, error: message }, { status: 500 });
  }
};

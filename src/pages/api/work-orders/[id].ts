import type { APIRoute, APIContext } from 'astro';
import {
  getWorkOrderById,
  updateWorkOrderStatus,
  updateWorkOrder,
  type UpdateWorkOrderInput
} from '@/server/services/work-order-service';
import { type WorkOrderStatus } from '@/server/db/types';
import { ZodError, z } from 'zod';
import { supabaseAdmin } from '@/server/db/client';
import { normalizeWorkType } from '@/server/auth/permissions';
import {
  type BodyReadResult,
  readBodyUniversal,
  normalizeAliases,
  isFormRequest,
  pickAlias,
  toStringTrim,
  optionalUuid,
  mapIssueToSpanish
} from './index';

const json = (res: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(res), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });

const uuidSchema = z.string().uuid();
const updatableKeys = [
  'workType',
  'patientId',
  'patient',
  'clientId',
  'predefinedClientName',
  'dueDate',
  'notes',
  'dentistId',
  'price'
];

const handleUpdateRequest = async (
  ctx: APIContext,
  preParsedBody?: BodyReadResult
): Promise<Response> => {
  if (!ctx.locals.user?.id) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const { request, params, locals } = ctx;
  const id = String(params.id);
  const formSubmission = isFormRequest(request);
  const redirectWithError = (message: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: `/app/work-orders/${id}/edit?error=${encodeURIComponent(message)}`
      }
    });

  try {
    const bodyResult = preParsedBody ?? (await readBodyUniversal(request));
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

    const wantsStatusOnly =
      payload.status !== undefined &&
      payload.status !== null &&
      updatableKeys.every((key) => !(key in payload));

    const currentUser = {
      id: locals.user.id,
      role: locals.user.role,
      email: locals.user.email ?? null
    };

    if (wantsStatusOnly) {
      const statusRaw = String(payload.status ?? '').trim().toUpperCase();
      const targetStatus = (Object.values(WorkOrderStatus) as string[]).includes(statusRaw)
        ? (statusRaw as WorkOrderStatus)
        : undefined;

      if (!targetStatus) {
        const message = 'Estado inválido';
        if (formSubmission) {
          return redirectWithError(message);
        }
        return json({ ok: false, error: message }, 400);
      }

      const message = payload.message ? String(payload.message) : undefined;
      const updated = await updateWorkOrderStatus(
        { workOrderId: id, status: targetStatus, message },
        currentUser
      );

      if (formSubmission) {
        return new Response(null, {
          status: 303,
          headers: { Location: `/app/work-orders/${id}` }
        });
      }

      return json({ ok: true, workOrder: updated }, 200);
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

    const updateInput: UpdateWorkOrderInput = {
      workOrderId: id
    };

    if ('dentistId' in payload) {
      const dentistRaw = toStringTrim(payload.dentistId);
      if (dentistRaw) {
        updateInput.dentistId = optionalUuid(payload.dentistId, 'dentistId');
      }
    }

    let clientIdUpdate: string | null | undefined = undefined;
    if ('clientId' in payload) {
      const clientRaw = toStringTrim(payload.clientId);
      if (!clientRaw) {
        clientIdUpdate = null;
      } else {
        clientIdUpdate = optionalUuid(payload.clientId, 'clientId');
      }
    }

    if (clientIdUpdate === undefined && 'predefinedClientName' in payload) {
      const predefinedClientName = toStringTrim(payload.predefinedClientName);
      if (predefinedClientName) {
        const { data: existingClient } = await supabaseAdmin
          .from('clients')
          .select('id')
          .eq('name', predefinedClientName)
          .maybeSingle();

        if (existingClient) {
          clientIdUpdate = existingClient.id;
        } else {
          const { data: createdClient, error } = await supabaseAdmin
            .from('clients')
            .insert({ name: predefinedClientName })
            .select('id')
            .single();
          if (error || !createdClient) {
            throw new Error('No se pudo crear el cliente');
          }
          clientIdUpdate = createdClient.id;
        }
      }
    }

    if (clientIdUpdate !== undefined) {
      updateInput.clientId = clientIdUpdate;
    }

    if ('patientId' in payload || 'patient' in payload) {
      updateInput.patientId = await resolvePatientId(payload.patientId);
    }

    if ('dueDate' in payload) {
      const dueDateRaw = toStringTrim(payload.dueDate);
      if (!dueDateRaw) {
        updateInput.dueDate = null;
      } else {
        const dueDate = new Date(dueDateRaw);
        if (Number.isNaN(dueDate.getTime())) {
          throw new ZodError([{ path: ['dueDate'], message: 'Fecha inválida', code: 'custom' }]);
        }
        updateInput.dueDate = dueDate;
      }
    }

    if ('notes' in payload) {
      const notes = toStringTrim(payload.notes);
      updateInput.notes = notes.length ? notes : null;
    }

    if ('workType' in payload) {
      const rawWorkType = payload.workType;
      if (rawWorkType === null) {
        updateInput.workType = null;
      } else {
        const hasValue =
          rawWorkType !== undefined &&
          rawWorkType !== null &&
          (Array.isArray(rawWorkType)
            ? rawWorkType.length > 0
            : typeof rawWorkType === 'string'
              ? rawWorkType.trim().length > 0
              : true);

        if (!hasValue) {
          updateInput.workType = null;
        } else {
          const normalized = normalizeWorkType(rawWorkType);
          if (!normalized) {
            throw new ZodError([{ path: ['workType'], message: 'Tipo de trabajo inválido', code: 'custom' }]);
          }
          updateInput.workType = normalized as UpdateWorkOrderInput['workType'];
        }
      }
    }

    const updated = await updateWorkOrder(updateInput, currentUser);

    if (formSubmission) {
      return new Response(null, {
        status: 303,
        headers: { Location: `/app/work-orders/${id}?updated=1` }
      });
    }

    return json({ ok: true, workOrder: updated }, 200);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const issues = error.errors?.map((issue) => ({
        path: issue.path,
        message: mapIssueToSpanish(issue)
      })) ?? [];
      const message = issues[0]?.message ?? 'Datos inválidos';

      if (formSubmission) {
        return redirectWithError(message);
      }

      return json({ ok: false, error: message, issues }, 400);
    }

    console.error('[work-orders/:id][PUT] error', error);
    const message = error instanceof Error ? error.message : 'Server error';

    if (formSubmission) {
      return redirectWithError(message);
    }

    const statusCode = typeof message === 'string' && message.toLowerCase().includes('not found') ? 404 : 500;
    return json({ ok: false, error: message }, statusCode);
  }
};

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    if (!locals.user?.id) return json({ ok: false, error: 'unauthorized' }, 401);
    const id = String(params.id);
    const workOrder = await getWorkOrderById(id, {
      id: locals.user.id,
      role: locals.user.role,
      email: locals.user.email ?? null
    });
    if (!workOrder) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, workOrder }, 200);
  } catch (error: unknown) {
    console.error('[work-orders/:id][GET] error', error);
    const message = error instanceof Error ? error.message : 'Server error';
    return json({ ok: false, error: message }, 500);
  }
};

export const PUT: APIRoute = async (ctx) => handleUpdateRequest(ctx);

export const POST: APIRoute = async (ctx) => {
  const bodyResult = await readBodyUniversal(ctx.request);
  const override = String((bodyResult.body?._method ?? '') as string).toUpperCase();

  if (override === 'PUT') {
    delete bodyResult.body?._method;
    return handleUpdateRequest(ctx, bodyResult);
  }

  return json({ ok: false, error: 'Método no soportado' }, 405);
};

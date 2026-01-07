import { WorkOrderStatus, WorkOrderFileType, AppointmentStatus, WorkType, Role } from '@/server/db/types';
import type { WorkOrderScope } from '@/server/auth/permissions';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { supabaseAdmin } from '@/server/db/client';
import { scheduleWorkOrderReminder } from '../queue/alert-queue';
import { logger } from '../logger';
import { realtime } from '../realtime/hub';
import {
  WorkOrderCreateInput,
  canSeePrices,
  workOrderScopeForUser
} from '@/server/auth/permissions';

const uuidSchema = z.string().uuid();

const fileSchema = z.object({
  kind: z.nativeEnum(WorkOrderFileType),
  url: z.string().url(),
  size: z.number().int().nonnegative(),
  mime: z.string().min(1),
  uploadedBy: z.string().optional()
});

const createWorkOrderSchema = WorkOrderCreateInput.extend({
  files: z.array(fileSchema).optional(),
  workType: z.string().optional()
});

const updateWorkOrderSchema = z.object({
  workOrderId: uuidSchema,
  dentistId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  clientId: z.string().uuid().nullable().optional(),
  labId: z.string().uuid().nullable().optional(),
  doctorId: z.string().uuid().nullable().optional(),
  clinicId: z.string().uuid().nullable().optional(),
  dueDate: z.union([z.coerce.date(), z.null()]).optional(),
  notes: z.string().max(5000).nullable().optional(),
  workType: z.nativeEnum(WorkType).nullable().optional(),
  price: z.coerce.number().nonnegative().optional()
});

const updateStatusSchema = z.object({
  workOrderId: uuidSchema,
  status: z.nativeEnum(WorkOrderStatus),
  message: z.string().max(1000).optional()
});

const listSchema = z.object({
  dentistId: uuidSchema.optional(),
  labId: uuidSchema.optional(),
  clientId: uuidSchema.optional(),
  doctorId: uuidSchema.optional(),
  clinicId: uuidSchema.optional(),
  status: z.nativeEnum(WorkOrderStatus).optional(),
  search: z.string().optional(),
  take: z.number().int().positive().max(100).optional(),
  skip: z.number().int().nonnegative().optional(),
  sort: z
    .enum([
      'createdAt_asc',
      'createdAt_desc',
      'client_asc',
      'client_desc',
      'updatedAt_desc',
      'code_asc',
      'code_desc',
      'number_asc',
      'number_desc'
    ])
    .optional()
});

const eventSchema = z.object({
  type: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.any()).optional()
});

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;
export type UpdateWorkOrderStatusInput = z.infer<typeof updateStatusSchema>;
export type ListWorkOrdersInput = z.infer<typeof listSchema>;
export type WorkOrderEventInput = z.infer<typeof eventSchema>;

type CurrentUser = {
  id: string;
  role: Role;
  email?: string | null;
} | null | undefined;

type WorkOrderRecord = Record<string, any>;

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 45;

const baseSelect =
  'id,code,sequentialNumber,displayCode,status,dentistId,labId,patientId,clientId,doctorId,clinicId,workType,extras,price,dueDate,notes,createdAt,updatedAt,patient:patientId(id,name),dentist:dentistId(id,name,email),lab:labId(id,name),client:clientId(id,name),doctor:doctorId(id,name,email),clinic:clinicId(id,name)';

const eventsSelect = 'id,workOrderId,type,message,metadata,createdAt';
const filesSelect = 'id,workOrderId,kind,url,size,mime,uploadedBy,createdAt';

const applyScope = (query: ReturnType<typeof supabaseAdmin.from>, scope?: WorkOrderScope) => {
  let scoped = query;
  if (scope?.eq) {
    for (const [key, value] of Object.entries(scope.eq)) {
      if (value) {
        scoped = scoped.eq(key, value);
      }
    }
  }
  if (scope?.or) {
    scoped = scoped.or(scope.or);
  }
  return scoped;
};

const generateWorkOrderCode = async () => {
  const year = new Date().getFullYear();
  const sequence = nanoid(6).toUpperCase();
  return `DD-${year}-${sequence}`;
};

const nextSequential = async () => {
  const { data } = await supabaseAdmin
    .from('work_orders')
    .select('sequentialNumber')
    .order('sequentialNumber', { ascending: false })
    .limit(1);
  return (data?.[0]?.sequentialNumber ?? 0) + 1;
};

const displayCodeFrom = (n: number) => `#${String(n).padStart(4, '0')}`;

const broadcast = (workOrderId: string, type: string, payload: Record<string, unknown>) => {
  realtime.publishWorkOrder({
    workOrderId,
    type,
    payload
  });
};

const sanitizePrice = <T extends { price: unknown }>(record: T, allowPrice: boolean): T => {
  if (allowPrice) return record;
  return { ...record, price: null } as T;
};

const formatWorkTypeLabel = (workType: string | undefined | null) => {
  if (!workType) return 'Orden de trabajo';
  return workType
    .split('_')
    .map((segment) =>
      segment.length ? segment.charAt(0) + segment.slice(1).toLowerCase() : segment
    )
    .join(' ');
};

const loadWorkOrderWithRelations = async (id: string) => {
  const { data: record, error } = await supabaseAdmin
    .from('work_orders')
    .select(baseSelect)
    .eq('id', id)
    .single();

  if (error || !record) {
    return null;
  }

  const [events, files] = await Promise.all([
    supabaseAdmin
      .from('work_order_events')
      .select(eventsSelect)
      .eq('workOrderId', id)
      .order('createdAt', { ascending: false })
      .limit(50)
      .then(({ data }) => data ?? []),
    supabaseAdmin
      .from('work_order_files')
      .select(filesSelect)
      .eq('workOrderId', id)
      .order('createdAt', { ascending: false })
      .then(({ data }) => data ?? [])
  ]);

  return { ...record, events, files };
};

const upsertAppointmentForOrder = async (order: WorkOrderRecord) => {
  if (!order.dueDate) return;
  const startsAt = new Date(order.dueDate);
  const endsAt = new Date(
    startsAt.getTime() + DEFAULT_APPOINTMENT_DURATION_MINUTES * 60 * 1000
  );
  const treatment = formatWorkTypeLabel(order.workType);
  const noteParts: string[] = [];
  const baseNotes = order.notes?.trim();
  if (baseNotes) {
    noteParts.push(baseNotes);
  }
  const displayRef = order.displayCode ?? order.code;
  noteParts.push(`Orden ${displayRef}`);
  const combinedNotes = noteParts.join('\n\n').trim();
  const appointmentNotes = combinedNotes.length > 0 ? combinedNotes.slice(0, 1000) : null;

  await supabaseAdmin.from('appointments').upsert(
    {
      id: order.id,
      patientId: order.patientId,
      dentistId: order.dentistId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      treatment,
      notes: appointmentNotes,
      status: AppointmentStatus.SCHEDULED
    },
    { onConflict: 'id' }
  );
};

export const createWorkOrder = async (input: CreateWorkOrderInput, currentUser?: CurrentUser) => {
  const data = createWorkOrderSchema.parse(input);
  const allowPrice = canSeePrices(currentUser ?? null);

  const seq = await nextSequential();
  const workOrderPayload = {
    code: await generateWorkOrderCode(),
    sequentialNumber: seq,
    displayCode: displayCodeFrom(seq),
    patientId: data.patientId,
    dentistId: data.dentistId,
    clientId: data.clientId ?? null,
    dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
    workType: data.workType ?? null,
    notes: data.notes ?? null,
    extras: data.extras ?? []
  };

  const { data: created, error } = await supabaseAdmin
    .from('work_orders')
    .insert(workOrderPayload)
    .select(baseSelect)
    .single();

  if (error || !created) {
    throw new Error('No se pudo crear la orden');
  }

  const eventPayload = {
    workOrderId: created.id,
    type: 'WORK_ORDER_CREATED',
    message: data.notes ?? 'Orden de trabajo creada',
    metadata: data.notes ? { notes: data.notes } : null
  };

  await supabaseAdmin.from('work_order_events').insert(eventPayload);

  if (data.files?.length) {
    await supabaseAdmin.from('work_order_files').insert(
      data.files.map((file) => ({
        workOrderId: created.id,
        kind: file.kind,
        url: file.url,
        size: file.size,
        mime: file.mime,
        uploadedBy: file.uploadedBy
      }))
    );
  }

  if (data.price && typeof data.price === 'number' && created.price) {
    const debtorId = created.clientId ?? created.clinicId ?? created.dentistId;
    if (debtorId) {
      await supabaseAdmin.from('account_statements').insert({
        userId: debtorId,
        workOrderId: created.id,
        amount: created.price,
        status: 'PENDING'
      });
    }
  }

  if (created.dueDate) {
    await upsertAppointmentForOrder(created);
  }

  const fullRecord = await loadWorkOrderWithRelations(created.id);

  if (fullRecord?.dueDate) {
    try {
      await scheduleWorkOrderReminder({
        workOrderId: fullRecord.id,
        dueDate: new Date(fullRecord.dueDate).toISOString(),
        dentistId: fullRecord.dentistId,
        labId: fullRecord.labId ?? undefined
      });
    } catch (error) {
      logger.warn({ error, workOrderId: fullRecord.id }, 'Failed to schedule work order reminder');
    }
  }

  broadcast(created.id, 'created', {
    status: created.status,
    dueDate: created.dueDate,
    code: created.displayCode
  });

  return fullRecord ? sanitizePrice(fullRecord, allowPrice) : sanitizePrice(created, allowPrice);
};

export const updateWorkOrder = async (input: UpdateWorkOrderInput, currentUser?: CurrentUser) => {
  const data = updateWorkOrderSchema.parse(input);
  const scope = workOrderScopeForUser(
    currentUser ? { id: currentUser.id, role: currentUser.role } : null
  );
  const allowPrice = canSeePrices(currentUser ?? null);

  const existing = await getWorkOrderById(data.workOrderId, currentUser);

  if (!existing) {
    throw new Error('Work order not found');
  }

  const updateData: Record<string, unknown> = {};
  if (data.dentistId !== undefined) updateData.dentistId = data.dentistId;
  if (data.patientId !== undefined) updateData.patientId = data.patientId;
  if (data.clientId !== undefined) updateData.clientId = data.clientId;
  if (data.labId !== undefined) updateData.labId = data.labId;
  if (data.doctorId !== undefined) updateData.doctorId = data.doctorId;
  if (data.clinicId !== undefined) updateData.clinicId = data.clinicId;
  if (data.notes !== undefined) updateData.notes = data.notes ?? null;
  if (data.workType !== undefined) updateData.workType = data.workType ?? null;
  if (data.price !== undefined) updateData.price = data.price;
  if (data.dueDate !== undefined)
    updateData.dueDate = data.dueDate ? new Date(data.dueDate).toISOString() : null;

  if (!Object.keys(updateData).length) {
    return sanitizePrice(existing, allowPrice);
  }

  let query = supabaseAdmin.from('work_orders').update(updateData).eq('id', data.workOrderId);
  query = applyScope(query, scope);

  const { data: updated, error } = await query.select(baseSelect).single();

  if (error || !updated) {
    throw new Error('No se pudo actualizar la orden');
  }

  if (data.dueDate !== undefined) {
    if (data.dueDate) {
      await upsertAppointmentForOrder(updated);
    } else {
      await supabaseAdmin.from('appointments').delete().eq('id', updated.id);
    }
  }

  const fullRecord = await loadWorkOrderWithRelations(updated.id);

  broadcast(updated.id, 'updated', {
    dueDate: updated.dueDate,
    workType: updated.workType,
    notes: updated.notes
  });

  return fullRecord ? sanitizePrice(fullRecord, allowPrice) : sanitizePrice(updated, allowPrice);
};

const statusTransitions: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  CREATED: [WorkOrderStatus.IN_PROGRESS],
  IN_PROGRESS: [WorkOrderStatus.DONE],
  DONE: [WorkOrderStatus.DELIVERED],
  DELIVERED: []
};

const transitionError = (from: WorkOrderStatus, to: WorkOrderStatus) =>
  new Error(`Transition from ${from} to ${to} is not allowed`);

export const updateWorkOrderStatus = async (
  input: UpdateWorkOrderStatusInput,
  currentUser?: CurrentUser
) => {
  const data = updateStatusSchema.parse(input);
  const scope = workOrderScopeForUser(
    currentUser ? { id: currentUser.id, role: currentUser.role } : null
  );
  const allowPrice = canSeePrices(currentUser ?? null);

  let query = supabaseAdmin
    .from('work_orders')
    .select(baseSelect)
    .eq('id', data.workOrderId);

  query = applyScope(query, scope);
  const { data: existing } = await query.maybeSingle();

  if (!existing) {
    throw new Error('Work order not found');
  }

  if (existing.status === data.status) {
    return sanitizePrice(existing, allowPrice);
  }

  const currentStatus = existing.status as WorkOrderStatus;
  const allowedNext = statusTransitions[currentStatus] ?? [];
  if (!allowedNext.includes(data.status)) {
    throw transitionError(currentStatus, data.status);
  }

  const message = data.message ?? `Status updated from ${existing.status} to ${data.status}`;

  const { data: updated, error } = await supabaseAdmin
    .from('work_orders')
    .update({ status: data.status })
    .eq('id', existing.id)
    .select(baseSelect)
    .single();

  if (error || !updated) {
    throw new Error('No se pudo actualizar la orden');
  }

  await supabaseAdmin.from('work_order_events').insert({
    workOrderId: existing.id,
    type: 'WORK_ORDER_STATUS_CHANGED',
    message,
    metadata: {
      from: existing.status,
      to: data.status
    }
  });

  const fullRecord = await loadWorkOrderWithRelations(updated.id);

  broadcast(updated.id, 'status-changed', {
    status: updated.status,
    message
  });

  return fullRecord ? sanitizePrice(fullRecord, allowPrice) : sanitizePrice(updated, allowPrice);
};

export const listWorkOrders = async (input: ListWorkOrdersInput, currentUser?: CurrentUser) => {
  const parsed = listSchema.parse(input);

  const baseFilters: Record<string, string> = {};
  if (parsed.dentistId) baseFilters.dentistId = parsed.dentistId;
  if (parsed.labId) baseFilters.labId = parsed.labId;
  if (parsed.clientId) baseFilters.clientId = parsed.clientId;
  if (parsed.doctorId) baseFilters.doctorId = parsed.doctorId;
  if (parsed.clinicId) baseFilters.clinicId = parsed.clinicId;
  if (parsed.status) baseFilters.status = parsed.status;

  const scope = workOrderScopeForUser(
    currentUser ? { id: currentUser.id, role: currentUser.role } : null
  );

  const take = parsed.take ?? 20;
  const skip = parsed.skip ?? 0;
  const sort = parsed.sort ?? 'updatedAt_desc';

  let query = supabaseAdmin.from('work_orders').select(baseSelect, { count: 'exact' });

  for (const [key, value] of Object.entries(baseFilters)) {
    query = query.eq(key, value);
  }

  query = applyScope(query, scope);

  if (parsed.search) {
    const search = parsed.search;
    const searchParts = [`code.ilike.%${search}%`, `displayCode.ilike.%${search}%`];
    const { data: patients } = await supabaseAdmin
      .from('patients')
      .select('id')
      .ilike('name', `%${search}%`)
      .limit(50);
    if (patients?.length) {
      const ids = patients.map((patient) => patient.id).join(',');
      searchParts.push(`patientId.in.(${ids})`);
    }
    query = query.or(searchParts.join(','));
  }

  switch (sort) {
    case 'createdAt_asc':
      query = query.order('createdAt', { ascending: true });
      break;
    case 'createdAt_desc':
      query = query.order('createdAt', { ascending: false });
      break;
    case 'code_asc':
      query = query.order('code', { ascending: true });
      break;
    case 'code_desc':
      query = query.order('code', { ascending: false });
      break;
    case 'number_asc':
      query = query.order('sequentialNumber', { ascending: true });
      break;
    case 'number_desc':
      query = query.order('sequentialNumber', { ascending: false });
      break;
    default:
      query = query.order('updatedAt', { ascending: false });
  }

  if (skip > 0) {
    query = query.range(skip, skip + take - 1);
  } else {
    query = query.limit(take);
  }

  const { data: items = [], count: total = 0 } = await query;

  const allowPrice = canSeePrices(currentUser ?? null);

  return {
    items: allowPrice
      ? items
      : items.map((item: WorkOrderRecord) => sanitizePrice(item, allowPrice)),
    total: total ?? 0,
    take,
    skip
  };
};

export const getWorkOrderById = async (id: string, currentUser?: CurrentUser) => {
  const ok = uuidSchema.safeParse(id);
  if (!ok.success) {
    return null;
  }

  const scope = workOrderScopeForUser(
    currentUser ? { id: currentUser.id, role: currentUser.role } : null
  );
  const allowPrice = canSeePrices(currentUser ?? null);

  let query = supabaseAdmin.from('work_orders').select(baseSelect).eq('id', id);
  query = applyScope(query, scope);

  const { data: record } = await query.maybeSingle();
  if (!record) return null;

  const fullRecord = await loadWorkOrderWithRelations(record.id);
  const result = fullRecord ?? record;
  return sanitizePrice(result, allowPrice);
};

export const addWorkOrderEvent = async (workOrderId: string, input: WorkOrderEventInput) => {
  const event = eventSchema.parse(input);

  const { data: record, error } = await supabaseAdmin
    .from('work_order_events')
    .insert({
      workOrderId,
      type: event.type,
      message: event.message,
      metadata: event.metadata ?? null
    })
    .select('*')
    .single();

  if (error || !record) {
    throw new Error('No se pudo crear el evento');
  }

  broadcast(workOrderId, 'event-appended', {
    id: record.id,
    type: record.type,
    message: record.message
  });

  return record;
};

export const attachWorkOrderFile = async (workOrderId: string, input: z.infer<typeof fileSchema>) => {
  const file = fileSchema.parse(input);

  const { data: stored, error } = await supabaseAdmin
    .from('work_order_files')
    .insert({
      workOrderId,
      kind: file.kind,
      url: file.url,
      size: file.size,
      mime: file.mime,
      uploadedBy: file.uploadedBy ?? null
    })
    .select('*')
    .single();

  if (error || !stored) {
    throw new Error('No se pudo adjuntar el archivo');
  }

  await addWorkOrderEvent(workOrderId, {
    type: 'FILE_ATTACHED',
    message: `${file.kind} subido`
  });

  return stored;
};

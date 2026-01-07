import type { APIRoute } from 'astro';
import { ZodError, z } from 'zod';
import { supabaseAdmin } from '@/server/db/client';
import {
  canCreateWorkOrder,
  workOrderScopeForUser
} from '@/server/auth/permissions';
import { json } from '@/server/utils/http';

const querySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, 'Query is required')
    .max(100, 'Query too long'),
  take: z
    .number()
    .int()
    .positive()
    .max(25)
    .default(10)
});

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const user = locals.user;
    if (!user?.id) {
      return json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    if (!canCreateWorkOrder(user)) {
      return json({ ok: false, error: 'forbidden' }, { status: 403 });
    }

    const parsed = querySchema.safeParse({
      q: url.searchParams.get('q') ?? '',
      take: url.searchParams.get('take')
        ? Number(url.searchParams.get('take'))
        : undefined
    });

    if (!parsed.success) {
      return json(
        {
          ok: false,
          error: 'invalid_query',
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const { q, take } = parsed.data;

    const scope = workOrderScopeForUser({ id: user.id, role: user.role });

    let patientIds: string[] | undefined;

    if (scope) {
      let scopedQuery = supabaseAdmin.from('work_orders').select('patientId');
      if (scope.eq) {
        for (const [key, value] of Object.entries(scope.eq)) {
          if (value) {
            scopedQuery = scopedQuery.eq(key, value);
          }
        }
      }
      if (scope.or) {
        scopedQuery = scopedQuery.or(scope.or);
      }

      const { data: scopedOrders, error: scopedError } = await scopedQuery;
      if (scopedError) {
        return json({ ok: false, error: 'Server error' }, { status: 500 });
      }
      patientIds = Array.from(
        new Set((scopedOrders ?? []).map((row) => row.patientId).filter(Boolean))
      );

      if (!patientIds.length) {
        return json({ ok: true, patients: [] }, { status: 200 });
      }
    }

    let query = supabaseAdmin
      .from('patients')
      .select('id,name')
      .ilike('name', `%${q}%`)
      .order('name', { ascending: true })
      .limit(take);

    if (patientIds) {
      query = query.in('id', patientIds);
    }

    const { data: patients = [], error: patientsError } = await query;
    if (patientsError) {
      return json({ ok: false, error: 'Server error' }, { status: 500 });
    }

    const patientIdList = patients.map((patient) => patient.id);
    let latestByPatient = new Map<string, string>();

    if (patientIdList.length) {
      const { data: orders, error: ordersError } = await supabaseAdmin
        .from('work_orders')
        .select('patientId,createdAt')
        .in('patientId', patientIdList)
        .order('createdAt', { ascending: false });

      if (ordersError) {
        return json({ ok: false, error: 'Server error' }, { status: 500 });
      }

      for (const order of orders ?? []) {
        if (!latestByPatient.has(order.patientId)) {
          latestByPatient.set(order.patientId, order.createdAt);
        }
      }
    }

    const items = patients.map((patient) => ({
      id: patient.id,
      name: patient.name,
      lastOrderAt: latestByPatient.get(patient.id) ?? null
    }));

    return json({ ok: true, patients: items }, { status: 200 });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(
        { ok: false, error: 'invalid_query', issues: error.issues },
        { status: 400 }
      );
    }

    console.error('[patients/search] error', error);
    return json({ ok: false, error: 'Server error' }, { status: 500 });
  }
};

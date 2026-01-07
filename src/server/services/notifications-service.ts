import { supabaseAdmin } from '@/server/db/client';
import { workOrderScopeForUser } from '@/server/auth/permissions';
import { addDays, startOfDay } from 'date-fns';
import { Role, WorkOrderStatus } from '@/server/db/types';

type UserContext = {
  id: string;
  role: Role;
  clinicId?: string | null;
  labId?: string | null;
  clientId?: string | null;
};

export type WorkOrderNotification = {
  id: string;
  code: string;
  dueDateISO: string;
  status: WorkOrderStatus;
  workType: string | null;
  patient: string;
  client: string;
};

export const getDueTomorrowWorkOrderNotifications = async (
  user: UserContext
): Promise<WorkOrderNotification[]> => {
  const now = new Date();
  const tomorrowStart = startOfDay(addDays(now, 1));
  const dayAfterTomorrowStart = addDays(tomorrowStart, 1);

  const scope = workOrderScopeForUser(user);

  let query = supabaseAdmin
    .from('work_orders')
    .select('id,displayCode,dueDate,status,workType,patient:patientId(name),client:clientId(name)')
    .gte('dueDate', tomorrowStart.toISOString())
    .lt('dueDate', dayAfterTomorrowStart.toISOString())
    .in('status', [WorkOrderStatus.CREATED, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.DONE])
    .order('dueDate', { ascending: true });

  if (scope?.eq) {
    for (const [key, value] of Object.entries(scope.eq)) {
      if (value) {
        query = query.eq(key, value);
      }
    }
  }

  if (scope?.or) {
    query = query.or(scope.or);
  }

  const { data: orders = [], error } = await query;

  if (error) {
    throw new Error('No se pudieron cargar notificaciones');
  }

  return orders
    .filter((order) => order.dueDate != null)
    .map((order) => ({
      id: order.id,
      code: order.displayCode ?? order.id.slice(0, 6).toUpperCase(),
      dueDateISO: order.dueDate ? new Date(order.dueDate).toISOString() : '',
      status: order.status,
      workType: order.workType,
      patient: order.patient?.name ?? 'Sin paciente',
      client: order.client?.name ?? 'Sin cliente'
    }));
};

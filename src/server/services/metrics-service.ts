import { supabaseAdmin } from '@/server/db/client';
import { canSeePrices, workOrderScopeForUser, type WorkOrderScope } from '@/server/auth/permissions';
import { Role } from '@/server/db/types';
import { startOfDay, startOfWeek, subDays, endOfDay } from 'date-fns';

type CurrentUser = {
  id: string;
  role: Role;
  email?: string | null;
};

export type DashboardMetrics = {
  ordersToday: number;
  ordersThisWeek: number;
  pendingOrders: number;
  billableAmount: string | null;
  trend: { date: string; count: number }[];
};

const toMoney = (value: number | string | null | undefined): string => {
  if (value == null) return '0';
  if (typeof value === 'number') return value.toFixed(2);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : String(value);
};

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

const countFor = async (query: ReturnType<typeof supabaseAdmin.from>) => {
  const { count, error } = await query.select('id', { count: 'exact', head: true });
  if (error) return 0;
  return count ?? 0;
};

export const getDashboardMetrics = async (user: CurrentUser): Promise<DashboardMetrics> => {
  const now = new Date();
  const scope = workOrderScopeForUser({ id: user.id, role: user.role });

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  const ordersTodayQuery = applyScope(
    supabaseAdmin.from('work_orders')
      .gte('createdAt', todayStart.toISOString())
      .lte('createdAt', todayEnd.toISOString()),
    scope
  );

  const ordersWeekQuery = applyScope(
    supabaseAdmin.from('work_orders')
      .gte('createdAt', weekStart.toISOString())
      .lte('createdAt', todayEnd.toISOString()),
    scope
  );

  const pendingQuery = applyScope(
    supabaseAdmin.from('work_orders')
      .in('status', ['CREATED', 'IN_PROGRESS', 'DONE']),
    scope
  );

  const [ordersToday, ordersThisWeek, pendingOrders] = await Promise.all([
    countFor(ordersTodayQuery),
    countFor(ordersWeekQuery),
    countFor(pendingQuery)
  ]);

  let billableAmount: string | null = null;
  if (canSeePrices(user)) {
    let priceQuery = applyScope(
      supabaseAdmin.from('work_orders').select('price').not('price', 'is', null),
      scope
    );

    const { data: rows, error } = await priceQuery;
    if (!error) {
      const total = (rows ?? []).reduce((acc, row) => acc + Number(row.price ?? 0), 0);
      billableAmount = toMoney(total);
    }
  }

  const startRange = startOfDay(subDays(now, 6));
  const trendQuery = applyScope(
    supabaseAdmin
      .from('work_orders')
      .select('createdAt')
      .gte('createdAt', startRange.toISOString())
      .lte('createdAt', todayEnd.toISOString()),
    scope
  );

  const { data: trendOrders = [] } = await trendQuery;

  const countsByDay = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const day = startOfDay(subDays(now, 6 - i));
    countsByDay.set(day.toISOString().slice(0, 10), 0);
  }

  trendOrders.forEach((order) => {
    const key = startOfDay(new Date(order.createdAt)).toISOString().slice(0, 10);
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
  });

  const trend = Array.from(countsByDay.entries()).map(([date, count]) => ({
    date,
    count
  }));

  return {
    ordersToday,
    ordersThisWeek,
    pendingOrders,
    billableAmount,
    trend
  };
};

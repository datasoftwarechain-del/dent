import { supabaseAdmin } from '@/server/db/client';
import { Role } from '@/server/db/types';
import { addDays, addMonths, startOfDay, startOfMonth, subDays, subMonths } from 'date-fns';

type UserContext = {
  id?: string;
  role?: string | null;
};

type AppointmentRow = {
  patientId: string;
  startsAt: string;
  treatment: string | null;
  status: string;
  patient?: { name: string | null } | null;
};

type WorkOrderRow = {
  id: string;
  displayCode: string | null;
  createdAt: string;
  status: string;
  workType: string | null;
  patient?: { name: string | null } | null;
  client?: { name: string | null } | null;
  price?: number | null;
};

const clampPct = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

const appointmentScope = (user: UserContext) => {
  if (user?.role === Role.DENTIST && user.id) {
    return { dentistId: user.id };
  }
  return {};
};

const workOrderScope = (user: UserContext) => {
  if (user?.role === Role.DENTIST && user.id) {
    return { dentistId: user.id };
  }
  return {};
};

const applyScope = <T extends ReturnType<typeof supabaseAdmin.from>>(
  query: T,
  scope: Record<string, string>
) => {
  let scoped = query;
  for (const [key, value] of Object.entries(scope)) {
    scoped = scoped.eq(key, value);
  }
  return scoped;
};

export const getDashboardSummary = async (user: UserContext) => {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = addDays(todayStart, 1);
  const monthStart = startOfMonth(now);
  const nextMonthStart = addMonths(monthStart, 1);
  const prevMonthStart = subMonths(monthStart, 1);
  const upcomingLimit = addDays(now, 7);
  const recentOrdersWindowStart = subDays(now, 14);

  const appointmentFilters = appointmentScope(user);
  const workOrderFilters = workOrderScope(user);

  const totalTodayQuery = applyScope(
    supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .gte('startsAt', todayStart.toISOString())
      .lt('startsAt', todayEnd.toISOString()),
    appointmentFilters
  );

  const confirmedTodayQuery = applyScope(
    supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .gte('startsAt', todayStart.toISOString())
      .lt('startsAt', todayEnd.toISOString())
      .in('status', ['SCHEDULED', 'COMPLETED']),
    appointmentFilters
  );

  const [totalTodayResult, confirmedTodayResult] = await Promise.all([
    totalTodayQuery,
    confirmedTodayQuery
  ]);

  const totalToday = totalTodayResult.count ?? 0;
  const confirmedToday = confirmedTodayResult.count ?? 0;

  const upcomingConsultsQuery = applyScope(
    supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .gte('startsAt', now.toISOString())
      .lt('startsAt', upcomingLimit.toISOString())
      .ilike('treatment', '%consulta%'),
    appointmentFilters
  );

  const upcomingPatientsQuery = applyScope(
    supabaseAdmin
      .from('appointments')
      .select('startsAt,treatment,patient:patientId(name),status')
      .gte('startsAt', now.toISOString())
      .lt('startsAt', upcomingLimit.toISOString())
      .not('status', 'in', '("CANCELLED","NO_SHOW")')
      .order('startsAt', { ascending: true })
      .limit(5),
    appointmentFilters
  );

  const todaysAgendaQuery = applyScope(
    supabaseAdmin
      .from('appointments')
      .select('startsAt,treatment,status,patient:patientId(name)')
      .gte('startsAt', todayStart.toISOString())
      .lt('startsAt', todayEnd.toISOString())
      .order('startsAt', { ascending: true }),
    appointmentFilters
  );

  const currentRevenueQuery = applyScope(
    supabaseAdmin
      .from('work_orders')
      .select('price,createdAt')
      .gte('createdAt', monthStart.toISOString())
      .lt('createdAt', nextMonthStart.toISOString())
      .not('price', 'is', null),
    workOrderFilters
  );

  const previousRevenueQuery = applyScope(
    supabaseAdmin
      .from('work_orders')
      .select('price,createdAt')
      .gte('createdAt', prevMonthStart.toISOString())
      .lt('createdAt', monthStart.toISOString())
      .not('price', 'is', null),
    workOrderFilters
  );

  const monthAppointmentsQuery = applyScope(
    supabaseAdmin
      .from('appointments')
      .select('patientId,startsAt,status,treatment,patient:patientId(name)')
      .gte('startsAt', monthStart.toISOString())
      .lt('startsAt', nextMonthStart.toISOString())
      .not('status', 'in', '("CANCELLED")'),
    appointmentFilters
  );

  const recentWorkOrdersQuery = applyScope(
    supabaseAdmin
      .from('work_orders')
      .select('id,displayCode,createdAt,status,workType,patient:patientId(name),client:clientId(name)')
      .gte('createdAt', recentOrdersWindowStart.toISOString())
      .lte('createdAt', now.toISOString())
      .order('createdAt', { ascending: false })
      .limit(6),
    workOrderFilters
  );

  const [
    upcomingConsultsResult,
    upcomingPatientsResult,
    todaysAgendaResult,
    currentRevenueResult,
    previousRevenueResult,
    monthAppointmentsResult,
    recentWorkOrdersResult
  ] = await Promise.all([
    upcomingConsultsQuery,
    upcomingPatientsQuery,
    todaysAgendaQuery,
    currentRevenueQuery,
    previousRevenueQuery,
    monthAppointmentsQuery,
    recentWorkOrdersQuery
  ]);

  const upcomingConsults = upcomingConsultsResult.count ?? 0;
  const upcomingPatients = (upcomingPatientsResult.data ?? []) as AppointmentRow[];
  const todaysAgenda = (todaysAgendaResult.data ?? []) as AppointmentRow[];
  const currentRevenueRows = (currentRevenueResult.data ?? []) as { price: number }[];
  const previousRevenueRows = (previousRevenueResult.data ?? []) as { price: number }[];
  const monthAppointments = (monthAppointmentsResult.data ?? []) as AppointmentRow[];
  const recentWorkOrders = (recentWorkOrdersResult.data ?? []) as WorkOrderRow[];

  const revenueMTD = currentRevenueRows.reduce((acc, row) => acc + Number(row.price ?? 0), 0);
  const revenuePrev = previousRevenueRows.reduce((acc, row) => acc + Number(row.price ?? 0), 0);
  const revenueMTDChangePct =
    revenuePrev > 0 ? ((revenueMTD - revenuePrev) / revenuePrev) * 100 : 0;

  const newPatientFirstVisit = new Map<string, Date>();
  for (const appointment of monthAppointments) {
    const startsAt = new Date(appointment.startsAt);
    const existing = newPatientFirstVisit.get(appointment.patientId);
    if (!existing || startsAt < existing) {
      newPatientFirstVisit.set(appointment.patientId, startsAt);
    }
  }

  const newPatientsThisMonth = Array.from(newPatientFirstVisit.values()).filter(
    (date) => date >= monthStart && date < nextMonthStart
  ).length;

  const nextPatients = upcomingPatients.map((entry) => ({
    name: entry.patient?.name ?? 'Sin paciente',
    treatment: entry.treatment ?? undefined,
    timeISO: new Date(entry.startsAt).toISOString()
  }));

  const agenda = todaysAgenda.map((entry) => ({
    time: new Date(entry.startsAt).toISOString(),
    patient: entry.patient?.name ?? 'Sin paciente',
    treatment: entry.treatment ?? undefined,
    status: entry.status
  }));

  const progressByPatient = new Map<
    string,
    {
      total: number;
      completed: number;
      name: string;
      treatment?: string | null;
    }
  >();

  monthAppointments.forEach((appointment) => {
    const bucket = progressByPatient.get(appointment.patientId) ?? {
      total: 0,
      completed: 0,
      name: appointment.patient?.name ?? 'Paciente',
      treatment: appointment.treatment
    };
    bucket.total += 1;
    if (appointment.status === 'COMPLETED') {
      bucket.completed += 1;
    }
    if (!bucket.treatment && appointment.treatment) {
      bucket.treatment = appointment.treatment;
    }
    progressByPatient.set(appointment.patientId, bucket);
  });

  const [progressEntry] = Array.from(progressByPatient.values()).sort(
    (a, b) => b.total - a.total
  );

  const treatmentProgress = progressEntry
    ? {
        label: `Paciente: ${progressEntry.name} – ${progressEntry.treatment ?? 'Tratamiento general'} (Etapa ${Math.min(progressEntry.completed, progressEntry.total)}/${progressEntry.total})`,
        steps: progressEntry.total,
        current: Math.min(progressEntry.completed, progressEntry.total)
      }
    : {
        label: 'Sin tratamientos activos',
        steps: 0,
        current: 0
      };

  const recentOrders = recentWorkOrders.map((order) => ({
    id: order.id,
    code: order.displayCode ?? order.id.slice(0, 6).toUpperCase(),
    createdAt: new Date(order.createdAt).toISOString(),
    status: order.status,
    workType: order.workType,
    patient: order.patient?.name ?? 'Sin paciente',
    client: order.client?.name ?? 'Sin cliente'
  }));

  return {
    period: {
      todayISO: now.toISOString(),
      month: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`
    },
    kpis: {
      todaysPatientsConfirmed: confirmedToday,
      revenueMTD,
      revenueMTDChangePct,
      upcomingNewConsults: upcomingConsults
    },
    overview: {
      occupancyPctToday: totalToday > 0 ? clampPct((confirmedToday / totalToday) * 100) : 0,
      newPatientsThisMonth,
      nextPatients
    },
    treatmentProgress,
    agenda,
    recentOrders
  };
};

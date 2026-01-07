import { Role } from '@/server/db/types';
import { supabaseAdmin } from '@/server/db/client';

export type CalendarRange = 'week' | 'month';

export type CalendarEvent = {
  id: string;
  type: 'APPOINTMENT' | 'WORK_ORDER';
  title: string;
  start: Date;
  end?: Date | null;
  status?: string | null;
  patientName?: string | null;
  clientName?: string | null;
  metadata?: Record<string, unknown>;
};

type UserContext = {
  id: string;
  role: Role;
  clinicId?: string | null;
  labId?: string | null;
  clientId?: string | null;
};

const toDate = (value: string | Date | null | undefined) =>
  value ? (value instanceof Date ? value : new Date(value)) : null;

export const fetchCalendarEvents = async ({
  user,
  rangeStart,
  rangeEnd
}: {
  user: UserContext;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<CalendarEvent[]> => {
  let shouldFetchAppointments = true;
  let shouldFetchWorkOrders = true;

  let dentistIds: string[] | undefined;

  if (user.role === Role.DENTIST) {
    dentistIds = [user.id];
  } else if (user.role === Role.TECHNICIAN || user.role === Role.CLINIC_ADMIN) {
    if (user.clinicId) {
      const { data: dentists, error } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('clinicId', user.clinicId)
        .eq('role', Role.DENTIST);

      if (error) {
        shouldFetchAppointments = false;
      } else {
        dentistIds = (dentists ?? []).map((dentist) => dentist.id);
        if (!dentistIds.length) {
          shouldFetchAppointments = false;
        }
      }
    } else {
      shouldFetchAppointments = false;
      shouldFetchWorkOrders = false;
    }
  } else if (user.role === Role.LAB) {
    shouldFetchAppointments = false;
    if (!user.labId) {
      shouldFetchWorkOrders = false;
    }
  } else if (user.role === Role.CLIENT) {
    shouldFetchAppointments = false;
  } else if (user.role === Role.ADMIN) {
    // Admin can see all
  } else {
    shouldFetchAppointments = false;
    shouldFetchWorkOrders = false;
  }

  const [appointments, workOrders] = await Promise.all([
    shouldFetchAppointments
      ? (() => {
          let query = supabaseAdmin
            .from('appointments')
            .select('id,startsAt,endsAt,treatment,status,patient:patientId(name)')
            .gte('startsAt', rangeStart.toISOString())
            .lt('startsAt', rangeEnd.toISOString())
            .order('startsAt', { ascending: true });

          if (dentistIds?.length) {
            query = query.in('dentistId', dentistIds);
          }

          return query.then(({ data }) => data ?? []);
        })()
      : Promise.resolve([]),
    shouldFetchWorkOrders
      ? (() => {
          let query = supabaseAdmin
            .from('work_orders')
            .select('id,displayCode,dueDate,workType,status,patient:patientId(name),client:clientId(name)')
            .gte('dueDate', rangeStart.toISOString())
            .lt('dueDate', rangeEnd.toISOString())
            .order('dueDate', { ascending: true });

          if (user.role === Role.DENTIST) {
            query = query.eq('dentistId', user.id);
          } else if (user.role === Role.TECHNICIAN || user.role === Role.CLINIC_ADMIN) {
            if (user.clinicId) {
              query = query.eq('clinicId', user.clinicId);
            }
          } else if (user.role === Role.LAB && user.labId) {
            query = query.eq('labId', user.labId);
          } else if (user.role === Role.CLIENT) {
            const orParts = [`dentistId.eq.${user.id}`];
            if (user.clientId) {
              orParts.push(`clientId.eq.${user.clientId}`);
            }
            query = query.or(orParts.join(','));
          }

          return query.then(({ data }) => data ?? []);
        })()
      : Promise.resolve([])
  ]);

  const appointmentEvents: CalendarEvent[] = (appointments ?? []).map((appointment) => ({
    id: appointment.id,
    type: 'APPOINTMENT',
    title: appointment.treatment ?? 'Cita',
    start: toDate(appointment.startsAt) ?? new Date(),
    end: toDate(appointment.endsAt),
    status: appointment.status ?? null,
    patientName: appointment.patient?.name ?? 'Paciente'
  }));

  const workOrderEvents: CalendarEvent[] = (workOrders ?? [])
    .filter((order) => order.dueDate)
    .map((order) => ({
      id: order.id,
      type: 'WORK_ORDER',
      title: order.displayCode ?? 'Orden',
      start: toDate(order.dueDate) ?? new Date(),
      status: order.status ?? null,
      patientName: order.patient?.name ?? 'Paciente',
      clientName: order.client?.name ?? 'Cliente',
      metadata: {
        workType: order.workType
      }
    }));

  return [...appointmentEvents, ...workOrderEvents];
};

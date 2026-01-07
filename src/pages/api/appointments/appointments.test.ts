import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/server/db/types';

type QueryResult = { data: any; error: any };

const appointmentsResult: QueryResult = { data: [], error: null };
const patientsResult: QueryResult = { data: [], error: null };

const buildQuery = (result: QueryResult) => ({
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  then: (resolve: (value: any) => any, reject: (reason: any) => any) =>
    Promise.resolve(result).then(resolve, reject)
});

vi.mock('@/server/db/client', () => {
  const from = vi.fn((table: string) => {
    if (table === 'appointments') return buildQuery(appointmentsResult);
    if (table === 'patients') return buildQuery(patientsResult);
    return buildQuery({ data: [], error: null });
  });

  return { supabaseAdmin: { from } };
});

const { GET } = await import('./index');

const buildContext = (query: string) => {
  const url = new URL(`http://localhost/api/appointments${query}`);
  const request = new Request(url);
  return {
    request,
    url,
    params: {},
    locals: {
      user: {
        id: 'user-1',
        role: Role.CLINIC_ADMIN
      },
      session: null
    }
  };
};

describe('/api/appointments GET', () => {
  beforeEach(() => {
    appointmentsResult.data = [
      {
        id: 'appt-1',
        patientId: 'patient-1',
        dentistId: 'user-1',
        startsAt: new Date('2025-10-23T12:00:00.000Z'),
        endsAt: new Date('2025-10-23T12:45:00.000Z'),
        treatment: 'Control',
        notes: 'Recordar estudios',
        status: 'SCHEDULED',
        createdAt: new Date('2025-10-01T10:00:00.000Z'),
        updatedAt: new Date('2025-10-01T10:00:00.000Z'),
        patient: { id: 'patient-1', name: 'Paciente Demo' },
        dentist: { id: 'user-1', name: 'Dra. Demo', email: 'demo@example.com' }
      }
    ];
    appointmentsResult.error = null;
    patientsResult.data = [];
    patientsResult.error = null;
  });

  it('returns 200 with appointments array for a day query', async () => {
    const response = await GET(buildContext('?day=2025-10-23') as any);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: 'appt-1',
      status: 'SCHEDULED',
      patient: { name: 'Paciente Demo' }
    });
  });
});

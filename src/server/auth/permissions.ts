import { z } from 'zod';
import { WorkExtra, WorkType, Role, type MinimalUser } from '@/server/db/types';

const adminEmail = process.env.ADMIN_EMAIL;

export function isAdmin(user: MinimalUser): boolean {
  if (!user) return false;
  // Solo usuarios con rol ADMIN son administradores
  if (user.role === 'ADMIN') return true;
  // Fallback: TECHNICIAN con email específico (legacy)
  if (user.role === 'TECHNICIAN' && adminEmail) {
    return (user.email ?? null) === adminEmail;
  }
  return false;
}

export function isTecnico(user: MinimalUser): boolean {
  return !!user && user.role === 'TECHNICIAN';
}

export function canRunBilling(user: MinimalUser): boolean {
  return isAdmin(user);
}

export function canCreateWorkOrder(user: MinimalUser): boolean {
  if (!user) return false;
  return (
    user.role === 'ADMIN' ||
    user.role === 'TECHNICIAN' ||
    user.role === 'CLINIC_ADMIN' ||
    user.role === 'DENTIST' ||
    user.role === 'LAB' ||
    user.role === 'CLIENT'
  );
}

export function canSeePrices(user: MinimalUser): boolean {
  if (!user) return false;
  return user.role === 'ADMIN' || user.role === 'CLINIC_ADMIN' || user.role === 'TECHNICIAN';
}

export function canUploadWorkOrderFiles(user: MinimalUser): boolean {
  if (!user) return false;
  return (
    user.role === 'TECHNICIAN' ||
    user.role === 'CLINIC_ADMIN' ||
    user.role === 'DENTIST'
  );
}

export type WorkOrderScope = {
  or?: string;
  eq?: Record<string, string | null | undefined>;
};

export const workOrderScopeForUser = (user: MinimalUser): WorkOrderScope | undefined => {
  if (!user) return undefined;

  switch (user.role) {
    case Role.ADMIN:
      return undefined;
    case Role.CLIENT:
      return {
        or: `dentistId.eq.${user.id},clientId.eq.${user.id}`
      };
    case Role.DENTIST:
      return { eq: { dentistId: user.id ?? undefined } };
    case Role.LAB:
      return { eq: { labId: user.id ?? undefined } };
    case Role.TECHNICIAN:
    case Role.CLINIC_ADMIN:
      return { eq: { clinicId: user.clinicId ?? undefined } };
    default:
      return undefined;
  }
};

const workTypeEnum = z.nativeEnum(WorkType);
const workExtraEnum = z.nativeEnum(WorkExtra);
const extrasParser = z
  .array(workExtraEnum)
  .transform((values) => Array.from(new Set(values)));

export const WorkOrderCreateInput = z.object({
  dentistId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  labId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  clinicId: z.string().uuid().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().max(5000).optional(),
  workType: workTypeEnum.optional(),
  extras: z
    .preprocess((value) => {
      if (Array.isArray(value)) {
        return value.map((item) =>
          typeof item === 'string' ? item.trim().toUpperCase() : item
        );
      }
      if (value === undefined || value === null || value === '') {
        return [];
      }
      return [String(value).trim().toUpperCase()];
    }, extrasParser)
    .optional(),
  price: z.coerce.number().nonnegative().optional()
});

export type WorkOrderCreatePayload = z.infer<typeof WorkOrderCreateInput>;

// ==== Normalizers for WorkType & extras (robust to accents/spaces/case) ====
const WORK_TYPES = new Set([
  'PROTESIS',
  'CORONA_ZIRCONIA',
  'CORONA_A_PERNO',
  'MODELO_IMPRESO',
  'TERMINACION_1_A_5',
  'TERMINACION_6_A_10',
  'REPARACION',
  'PROVISORIO',
  'GANCHO_LABRADO'
]);

const WORK_EXTRAS = new Set(['TABLETA']);

const stripAccents = (input: string) =>
  input.normalize('NFD').replace(/\p{Diacritic}+/gu, '');

const workTypeMap: Record<string, WorkType> = {
  'CORONA': 'CORONA_ZIRCONIA',
  'INCRUSTACIONES': 'PROTESIS',
  'PIEZAS_INTERMEDIAS': 'PROTESIS',
  'CARILLAS': 'PROTESIS',
  'REHAB_SIN_IMPLANTES': 'PROTESIS',
  'CORONA_A_PERNO': 'CORONA_A_PERNO',
  'DISILICATO_DE_LITIO_O_FELDESPATO': 'PROTESIS',
  'DISEÑO_DE_SONRISAS_SMILE': 'PROTESIS',
  'JACKET_CERAMOMETÁLICA_Y/O_PIEZA_INTERMEDIA': 'CORONA_ZIRCONIA',
  'CERAMOMETÁLICA_A_PERNO': 'CORONA_A_PERNO',
  'INCRUSTACIÓN_O_CORONA_TOTAL_(CERAMAGE)': 'CORONA_ZIRCONIA',
  'PERNO_MUÑÓN': 'PROTESIS',
  'INCRUSTACIÓN_O_CORONA_(CR._NI._/_INCLUYE_COSTO_METAL)': 'CORONA_ZIRCONIA',
  'ESQUELETO_DE_CROMO_(+_ENVÍOS)': 'PROTESIS',
  'TERMINACIÓN_DE_1_A_5': 'TERMINACION_1_A_5',
  'TERMINACIÓN_DE_6_A_10': 'TERMINACION_6_A_10',
  'CUBETAS_INDIVIDUALES': 'PROTESIS',
  'COMPLETA': 'PROTESIS',
  'PPR_A_PLACA': 'PROTESIS',
  'TABLETA': 'PROTESIS',
  'GANCHO_LABRADO': 'GANCHO_LABRADO',
};

export const normalizeWorkTypeLabelToEnum = (value: string): WorkType | null => {
  // Ejemplos: "Corona" -> CORONA_ZIRCONIA, "Terminación de 1 a 5" -> TERMINACION_1_A_5.
  const s = stripAccents(value)
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_');

  if (s === 'CORONA' || s === 'CORONA_ZIRCONIO') {
    return 'CORONA_ZIRCONIA';
  }

  const mapped = workTypeMap[s as keyof typeof workTypeMap];
  if (mapped && WORK_TYPES.has(mapped)) {
    return mapped;
  }

  return WORK_TYPES.has(s) ? (s as WorkType) : null;
};

export const normalizeWorkType = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const result = normalizeWorkTypeLabelToEnum(item);
      if (result) {
        // TODO: soportar múltiples tipos de trabajo
        return result;
      }
    }
    return undefined;
  }

  if (typeof value === 'string') {
    return normalizeWorkTypeLabelToEnum(value) ?? undefined;
  }

  return undefined;
};

export const normalizeExtras = (value: unknown): string[] | undefined => {
  if (value == null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];

  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const normalized = stripAccents(entry).toUpperCase().trim().replace(/\s+/g, '_');
    if (WORK_EXTRAS.has(normalized)) {
      out.push(normalized);
    }
  }

  return out.length ? Array.from(new Set(out)) : undefined;
};

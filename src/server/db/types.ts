export enum Role {
  ADMIN = 'ADMIN',
  TECHNICIAN = 'TECHNICIAN',
  CLINIC_ADMIN = 'CLINIC_ADMIN',
  DENTIST = 'DENTIST',
  LAB = 'LAB',
  CLIENT = 'CLIENT'
}

export enum WorkType {
  PROTESIS = 'PROTESIS',
  CORONA_ZIRCONIA = 'CORONA_ZIRCONIA',
  CORONA_A_PERNO = 'CORONA_A_PERNO',
  MODELO_IMPRESO = 'MODELO_IMPRESO',
  TERMINACION_1_A_5 = 'TERMINACION_1_A_5',
  TERMINACION_6_A_10 = 'TERMINACION_6_A_10',
  REPARACION = 'REPARACION',
  PROVISORIO = 'PROVISORIO',
  GANCHO_LABRADO = 'GANCHO_LABRADO'
}

export enum WorkExtra {
  TABLETA = 'TABLETA',
  GANCHO_LABRADO = 'GANCHO_LABRADO'
}

export enum WorkOrderStatus {
  CREATED = 'CREATED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  DELIVERED = 'DELIVERED'
}

export enum WorkOrderFileType {
  PHOTO = 'PHOTO',
  SCAN = 'SCAN',
  STL = 'STL',
  OTHER = 'OTHER'
}

export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW'
}

export enum InvoiceStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED'
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export type UserProfile = {
  id: string;
  email: string | null;
  name: string | null;
  role: Role;
  clinicId?: string | null;
  labId?: string | null;
  clientId?: string | null;
  createdAt?: string;
};

export type MinimalUser = {
  id?: string;
  email?: string | null;
  role?: Role;
  clinicId?: string | null;
  labId?: string | null;
  clientId?: string | null;
} | null | undefined;

export const isRoleValue = (value: string | null | undefined): value is Role => {
  if (!value) return false;
  return Object.values(Role).includes(value as Role);
};

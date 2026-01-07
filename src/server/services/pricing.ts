import { WorkType } from '@/server/db/types';

export const WORK_TYPE_PRICES: Record<WorkType, number> = {
  PROTESIS: 2750,
  CORONA_ZIRCONIA: 2990,
  CORONA_A_PERNO: 3200,
  MODELO_IMPRESO: 400,
  TERMINACION_1_A_5: 3350,
  TERMINACION_6_A_10: 200,
  REPARACION: 1150,
  PROVISORIO: 1780,
  GANCHO_LABRADO: 1500
};

// TODO: Persistir precios en base de datos y permitir configuración desde UI.

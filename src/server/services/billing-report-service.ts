import { supabaseAdmin } from '@/server/db/client';
import { WorkOrderStatus, WorkType } from '@/server/db/types';
import { WORK_TYPE_PRICES } from './pricing';

type WorkOrderRow = {
  id: string;
  code: string | null;
  displayCode: string | null;
  status: string;
  price: number | string | null;
  workType: WorkType | string | null;
  dentist?: { id: string; name: string | null; email: string | null } | null;
};

const workTypePriceMap = new Map<string, number>(
  Object.entries(WORK_TYPE_PRICES as Record<string, number>).map(([key, value]) => [
    key.toUpperCase(),
    Number(value)
  ])
);

const toNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const priceForOrder = (order: WorkOrderRow) => {
  if (order.price != null && toNumber(order.price) > 0) {
    return toNumber(order.price);
  }
  if (!order.workType) return 0;
  const key = typeof order.workType === 'string' ? order.workType.toUpperCase() : order.workType;
  return workTypePriceMap.get(key) ?? 0;
};

const formatDebtor = (order: WorkOrderRow) =>
  order.dentist?.name ?? order.dentist?.email ?? 'Sin asignar';

export const getBillableOrdersForExport = async () => {
  const { data: orders = [], error } = await supabaseAdmin
    .from('work_orders')
    .select(
      'id,code,displayCode,status,price,workType,dentist:dentistId(id,name,email)'
    )
    .in('status', [WorkOrderStatus.DONE, WorkOrderStatus.DELIVERED])
    .order('updatedAt', { ascending: false });

  if (error) {
    throw new Error('No se pudieron cargar las órdenes');
  }

  const { data: invoiceLinks = [], error: invoiceError } = await supabaseAdmin
    .from('invoices')
    .select('workOrderId')
    .not('workOrderId', 'is', null);

  if (invoiceError) {
    throw new Error('No se pudieron cargar las facturas');
  }

  const invoicedIds = new Set(
    (invoiceLinks ?? [])
      .map((row) => row.workOrderId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );

  return (orders as WorkOrderRow[])
    .filter((order) => !invoicedIds.has(order.id))
    .map((order) => {
      const amount = priceForOrder(order);
      return {
        id: order.id,
        code: order.displayCode ?? order.code ?? order.id,
        amount: amount.toFixed(2),
        status: order.status ?? '',
        debtor: formatDebtor(order)
      };
    });
};

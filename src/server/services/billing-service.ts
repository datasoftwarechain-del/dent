import { z } from 'zod';
import { supabaseAdmin } from '@/server/db/client';
import { WorkOrderStatus, WorkType, PaymentStatus } from '@/server/db/types';
import { WORK_TYPE_PRICES } from './pricing';

const workTypePriceMap = new Map<string, number>(
  Object.entries(WORK_TYPE_PRICES as Record<string, number>).map(([key, value]) => [
    key.toUpperCase(),
    Number(value)
  ])
);

const priceForWorkType = (workType: WorkType | null | undefined) => {
  if (!workType) return 0;
  return workTypePriceMap.get(workType) ?? 0;
};

const formatWorkTypeLabel = (value: string | null | undefined) => {
  if (!value) return 'Orden de trabajo';
  return value
    .split('_')
    .map((segment) => (segment.length ? segment.charAt(0) + segment.slice(1).toLowerCase() : segment))
    .join(' ');
};

const uuidSchema = z.string().uuid();

const invoiceFromOrderSchema = z.object({
  orderId: uuidSchema
});

const paymentSchema = z.object({
  clientId: uuidSchema,
  amount: z.union([z.number(), z.string()]).transform((value) => Number(value)),
  date: z.coerce.date().optional(),
  note: z.string().max(200).optional()
});

const statementWithDateSchema = z.object({
  clientId: uuidSchema,
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional()
});

const getLatestBalance = async (clientId: string) => {
  const { data } = await supabaseAdmin
    .from('account_entries')
    .select('balanceAfter')
    .eq('clientId', clientId)
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();

  return Number(data?.balanceAfter ?? 0);
};

const createAccountEntry = async (params: {
  clientId: string;
  invoiceId: string;
  debit: number;
  credit: number;
  createdAt?: Date;
}) => {
  const previousBalance = await getLatestBalance(params.clientId);
  const nextBalance = previousBalance + params.debit - params.credit;

  const { data: entry, error } = await supabaseAdmin
    .from('account_entries')
    .insert({
      clientId: params.clientId,
      invoiceId: params.invoiceId,
      debit: params.debit,
      credit: params.credit,
      balanceAfter: nextBalance,
      createdAt: params.createdAt?.toISOString() ?? new Date().toISOString()
    })
    .select('*')
    .single();

  if (error || !entry) {
    throw new Error('No se pudo crear el movimiento de cuenta');
  }

  return entry;
};

export const createInvoiceFromOrder = async (orderId: string) => {
  const { orderId: validatedOrderId } = invoiceFromOrderSchema.parse({ orderId });

  const { data: order, error: orderError } = await supabaseAdmin
    .from('work_orders')
    .select('id,dentistId,status,workType,price,displayCode,patient:patientId(name)')
    .eq('id', validatedOrderId)
    .single();

  if (orderError || !order) {
    throw new Error('Orden no encontrada');
  }

  const billingClientId = order.dentistId;
  if (!billingClientId) {
    throw new Error('La orden no tiene un dentista/usuario asignado');
  }

  if (![WorkOrderStatus.DONE, WorkOrderStatus.DELIVERED].includes(order.status)) {
    throw new Error('La orden aún no está terminada');
  }

  const { data: existingInvoice } = await supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('workOrderId', order.id)
    .limit(1)
    .maybeSingle();

  if (existingInvoice) {
    throw new Error('La orden ya tiene una factura registrada');
  }

  const amountFromWorkType = priceForWorkType(order.workType);
  const finalAmount = amountFromWorkType > 0 ? amountFromWorkType : Number(order.price ?? 0);

  if (!finalAmount || finalAmount <= 0) {
    throw new Error('No se pudo determinar el precio de la orden');
  }

  const { data: invoice, error: invoiceError } = await supabaseAdmin
    .from('invoices')
    .insert({
      clientId: billingClientId,
      workOrderId: order.id,
      amount: finalAmount,
      currency: 'ARS',
      dueAt: new Date().toISOString(),
      status: 'PENDING'
    })
    .select('*')
    .single();

  if (invoiceError || !invoice) {
    throw new Error('No se pudo crear la factura');
  }

  if (!order.price) {
    await supabaseAdmin.from('work_orders').update({ price: finalAmount }).eq('id', order.id);
  }

  await createAccountEntry({
    clientId: billingClientId,
    invoiceId: invoice.id,
    debit: finalAmount,
    credit: 0,
    createdAt: new Date(invoice.createdAt)
  });

  return invoice;
};

export const recordPayment = async (input: z.infer<typeof paymentSchema>) => {
  const payload = paymentSchema.parse(input);

  const { data: client } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('id', payload.clientId)
    .maybeSingle();

  if (!client) {
    throw new Error('Cliente no encontrado');
  }

  if (!payload.amount || payload.amount <= 0) {
    throw new Error('El monto debe ser mayor a cero');
  }

  const { data: invoices = [] } = await supabaseAdmin
    .from('invoices')
    .select('id,amount,status,createdAt')
    .eq('clientId', payload.clientId)
    .in('status', ['PENDING'])
    .order('createdAt', { ascending: true });

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const { data: payments = [] } = invoiceIds.length
    ? await supabaseAdmin
        .from('payments')
        .select('invoiceId,amount,createdAt')
        .in('invoiceId', invoiceIds)
    : { data: [] as { invoiceId: string; amount: number }[] };

  const paymentsByInvoice = new Map<string, number>();
  for (const payment of payments ?? []) {
    const current = paymentsByInvoice.get(payment.invoiceId) ?? 0;
    paymentsByInvoice.set(payment.invoiceId, current + Number(payment.amount ?? 0));
  }

  let remaining = payload.amount;
  const createdPayments: any[] = [];
  let firstInvoiceId: string | null = null;

  for (const invoice of invoices) {
    if (remaining <= 0) break;

    const invoiceAmount = Number(invoice.amount ?? 0);
    const paidAmount = paymentsByInvoice.get(invoice.id) ?? 0;
    const outstandingAmount = invoiceAmount - paidAmount;

    if (outstandingAmount <= 0) continue;

    const applied = outstandingAmount >= remaining ? remaining : outstandingAmount;
    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .insert({
        invoiceId: invoice.id,
        provider: 'MANUAL',
        providerRef: payload.note ?? '',
        amount: applied,
        status: PaymentStatus.COMPLETED,
        createdAt: payload.date?.toISOString() ?? new Date().toISOString()
      })
      .select('*')
      .single();

    if (error || !payment) {
      throw new Error('No se pudo registrar el pago');
    }

    if (!firstInvoiceId) {
      firstInvoiceId = invoice.id;
    }

    const remainingAfter = outstandingAmount - applied;
    if (remainingAfter <= 0) {
      await supabaseAdmin
        .from('invoices')
        .update({ status: 'PAID' })
        .eq('id', invoice.id);
    }

    remaining -= applied;
    createdPayments.push(payment);
  }

  if (!firstInvoiceId) {
    const { data: anyInvoice } = await supabaseAdmin
      .from('invoices')
      .select('id')
      .eq('clientId', payload.clientId)
      .order('createdAt', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anyInvoice) {
      firstInvoiceId = anyInvoice.id;
    }
  }

  if (firstInvoiceId) {
    await createAccountEntry({
      clientId: payload.clientId,
      invoiceId: firstInvoiceId,
      debit: 0,
      credit: payload.amount,
      createdAt: payload.date ?? new Date()
    });
  }

  return createdPayments;
};

export const getStatementByClient = async (clientId: string, dateFrom?: Date, dateTo?: Date) => {
  const { clientId: validatedClientId, dateFrom: from, dateTo: to } =
    statementWithDateSchema.parse({ clientId, dateFrom, dateTo });

  const { data: client } = await supabaseAdmin
    .from('user_profiles')
    .select('id,name,email')
    .eq('id', validatedClientId)
    .maybeSingle();

  if (!client) {
    throw new Error('Cliente no encontrado');
  }

  let query = supabaseAdmin
    .from('account_entries')
    .select('id,clientId,invoiceId,debit,credit,balanceAfter,createdAt')
    .eq('clientId', validatedClientId)
    .order('createdAt', { ascending: true });

  if (from) {
    query = query.gte('createdAt', from.toISOString());
  }
  if (to) {
    const endOfDay = new Date(to);
    endOfDay.setHours(23, 59, 59, 999);
    query = query.lte('createdAt', endOfDay.toISOString());
  }

  const { data: entries = [], error } = await query;
  if (error) {
    throw new Error('No se pudieron cargar los movimientos');
  }

  const invoiceIds = Array.from(new Set(entries.map((entry) => entry.invoiceId).filter(Boolean)));

  const { data: invoices = [] } = invoiceIds.length
    ? await supabaseAdmin
        .from('invoices')
        .select('id,workOrderId,amount,currency,createdAt')
        .in('id', invoiceIds)
    : { data: [] };

  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

  const workOrderIds = Array.from(
    new Set(invoices.map((invoice) => invoice.workOrderId).filter(Boolean))
  );

  const { data: workOrders = [] } = workOrderIds.length
    ? await supabaseAdmin
        .from('work_orders')
        .select('id,displayCode,workType,patient:patientId(name)')
        .in('id', workOrderIds)
    : { data: [] };

  const workOrdersById = new Map(workOrders.map((order) => [order.id, order]));

  const { data: payments = [] } = invoiceIds.length
    ? await supabaseAdmin.from('payments').select('*').in('invoiceId', invoiceIds)
    : { data: [] };

  let facturasTotal = 0;
  let entregasTotal = 0;

  const rows = entries.map((entry) => {
    const debit = Number(entry.debit ?? 0);
    const credit = Number(entry.credit ?? 0);
    facturasTotal += debit;
    entregasTotal += credit;
    const balance = Number(entry.balanceAfter ?? 0);

    const invoice = invoicesById.get(entry.invoiceId);
    const order = invoice?.workOrderId ? workOrdersById.get(invoice.workOrderId) : null;

    let tipo = 'MOVIMIENTO';
    let compNro = invoice?.id ?? '';
    let detalle = 'Movimiento de cuenta';
    let patientName = '-';
    let paymentMatch = null as any;

    if (debit > 0) {
      tipo = 'FACTURA';
      compNro = order?.displayCode ?? invoice?.id ?? '';
      detalle = order?.workType ? formatWorkTypeLabel(order.workType) : 'Factura emitida';
      patientName = order?.patient?.name ?? '-';
    } else if (credit > 0) {
      tipo = 'PAGO';
      paymentMatch = (payments ?? []).find((payment) => {
        const paymentAmount = Number(payment.amount ?? 0);
        const sameAmount = paymentAmount === credit;
        const timeDiff = Math.abs(new Date(payment.createdAt).getTime() - new Date(entry.createdAt).getTime());
        return sameAmount && timeDiff < 5_000;
      });
      detalle = paymentMatch?.providerRef?.length ? paymentMatch.providerRef : 'Pago registrado';
      patientName = '-';
    }

    return {
      fecha: new Date(entry.createdAt).toISOString(),
      tipo,
      compNro,
      ordenId: invoice?.workOrderId ?? null,
      detalle,
      paciente: patientName,
      facturas: debit,
      entregas: credit,
      saldoAcumulado: balance,
      paymentId: tipo === 'PAGO' && paymentMatch ? paymentMatch.id : null,
      invoiceId: invoice?.id ?? null
    };
  });

  const totals = {
    facturas: facturasTotal,
    entregas: entregasTotal,
    saldo: facturasTotal - entregasTotal
  };

  return {
    client: {
      id: client.id,
      name: client.name ?? client.email ?? 'Cliente'
    },
    rows,
    totals
  };
};

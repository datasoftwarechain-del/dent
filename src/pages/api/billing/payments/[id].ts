import type { APIRoute } from 'astro';
import { supabaseAdmin } from '@/server/db/client';
import { isAdmin } from '@/server/auth/permissions';

const toNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const recomputeBalances = async (clientId: string) => {
  const { data: entries = [], error } = await supabaseAdmin
    .from('account_entries')
    .select('id,debit,credit,createdAt')
    .eq('clientId', clientId)
    .order('createdAt', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw new Error('No se pudo recalcular el estado de cuenta');
  }

  let running = 0;
  for (const entry of entries ?? []) {
    running = running + toNumber(entry.debit) - toNumber(entry.credit);
    const { error: updateError } = await supabaseAdmin
      .from('account_entries')
      .update({ balanceAfter: running })
      .eq('id', entry.id);

    if (updateError) {
      throw new Error('No se pudo actualizar el estado de cuenta');
    }
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  try {
    const user = locals.user;
    if (!user || !isAdmin(user)) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      });
    }

    const paymentId = params.id;
    if (!paymentId) {
      return new Response(JSON.stringify({ ok: false, error: 'ID de pago requerido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select('id,invoiceId,amount,createdAt')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      throw new Error('Pago no encontrado');
    }

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .select('id,clientId,amount')
      .eq('id', payment.invoiceId)
      .single();

    if (invoiceError || !invoice) {
      throw new Error('Factura no encontrada');
    }

    const paymentAmount = toNumber(payment.amount);
    const createdAt = new Date(payment.createdAt);
    const start = new Date(createdAt.getTime() - 5000).toISOString();
    const end = new Date(createdAt.getTime() + 5000).toISOString();

    const { data: accountEntry } = await supabaseAdmin
      .from('account_entries')
      .select('id')
      .eq('clientId', invoice.clientId)
      .eq('invoiceId', invoice.id)
      .eq('credit', paymentAmount)
      .gte('createdAt', start)
      .lte('createdAt', end)
      .order('createdAt', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (accountEntry) {
      const { error: entryDeleteError } = await supabaseAdmin
        .from('account_entries')
        .delete()
        .eq('id', accountEntry.id);

      if (entryDeleteError) {
        throw new Error('No se pudo eliminar el movimiento de cuenta');
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from('payments')
      .delete()
      .eq('id', paymentId);

    if (deleteError) {
      throw new Error('No se pudo eliminar el pago');
    }

    await recomputeBalances(invoice.clientId);

    const { data: remainingPayments = [], error: remainingError } = await supabaseAdmin
      .from('payments')
      .select('amount')
      .eq('invoiceId', invoice.id);

    if (remainingError) {
      throw new Error('No se pudieron validar los pagos restantes');
    }

    const totalPaid = (remainingPayments ?? []).reduce(
      (sum, row) => sum + toNumber(row.amount),
      0
    );

    if (totalPaid < toNumber(invoice.amount)) {
      const { error: statusError } = await supabaseAdmin
        .from('invoices')
        .update({ status: 'PENDING' })
        .eq('id', invoice.id);

      if (statusError) {
        throw new Error('No se pudo actualizar la factura');
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    console.error('[DELETE /api/billing/payments/:id]', error);
    const message = error instanceof Error ? error.message : 'Error al eliminar el pago';
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};

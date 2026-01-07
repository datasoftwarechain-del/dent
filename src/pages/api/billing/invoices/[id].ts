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

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  try {
    const user = locals.user;
    if (!user || !isAdmin(user)) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      });
    }

    const invoiceId = params.id;
    if (!invoiceId) {
      return new Response(JSON.stringify({ ok: false, error: 'ID de factura requerido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    const body = await request.json();
    const amountValue = toNumber(body?.amount);

    if (!amountValue || amountValue <= 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Monto inválido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .select('id,clientId,amount,createdAt')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      throw new Error('Factura no encontrada');
    }

    const oldAmount = toNumber(invoice.amount);

    if (oldAmount !== amountValue) {
      const { error: updateError } = await supabaseAdmin
        .from('invoices')
        .update({ amount: amountValue })
        .eq('id', invoiceId);

      if (updateError) {
        throw new Error('No se pudo actualizar la factura');
      }

      const createdAt = new Date(invoice.createdAt);
      const start = new Date(createdAt.getTime() - 5000).toISOString();
      const end = new Date(createdAt.getTime() + 5000).toISOString();

      let { data: accountEntry } = await supabaseAdmin
        .from('account_entries')
        .select('id')
        .eq('clientId', invoice.clientId)
        .eq('invoiceId', invoice.id)
        .eq('debit', oldAmount)
        .gte('createdAt', start)
        .lte('createdAt', end)
        .order('createdAt', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!accountEntry) {
        const { data: fallbackEntry } = await supabaseAdmin
          .from('account_entries')
          .select('id')
          .eq('clientId', invoice.clientId)
          .eq('invoiceId', invoice.id)
          .gt('debit', 0)
          .order('createdAt', { ascending: true })
          .limit(1)
          .maybeSingle();
        accountEntry = fallbackEntry ?? null;
      }

      if (accountEntry) {
        const { error: entryError } = await supabaseAdmin
          .from('account_entries')
          .update({ debit: amountValue })
          .eq('id', accountEntry.id);

        if (entryError) {
          throw new Error('No se pudo actualizar la cuenta del cliente');
        }
      }

      await recomputeBalances(invoice.clientId);
    }

    const { data: payments = [], error: paymentsError } = await supabaseAdmin
      .from('payments')
      .select('amount')
      .eq('invoiceId', invoiceId);

    if (paymentsError) {
      throw new Error('No se pudieron cargar los pagos');
    }

    const totalPaid = (payments ?? []).reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const nextStatus = totalPaid >= amountValue ? 'PAID' : 'PENDING';

    const { error: statusError } = await supabaseAdmin
      .from('invoices')
      .update({ status: nextStatus })
      .eq('id', invoiceId);

    if (statusError) {
      throw new Error('No se pudo actualizar el estado de la factura');
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    console.error('[PATCH /api/billing/invoices/:id]', error);
    const message = error instanceof Error ? error.message : 'Error al actualizar la factura';
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
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

    const invoiceId = params.id;
    if (!invoiceId) {
      return new Response(JSON.stringify({ ok: false, error: 'ID de factura requerido' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .select('id,clientId')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      throw new Error('Factura no encontrada');
    }

    const { error: paymentsError } = await supabaseAdmin
      .from('payments')
      .delete()
      .eq('invoiceId', invoiceId);

    if (paymentsError) {
      throw new Error('No se pudieron eliminar los pagos');
    }

    const { error: entriesError } = await supabaseAdmin
      .from('account_entries')
      .delete()
      .eq('invoiceId', invoiceId);

    if (entriesError) {
      throw new Error('No se pudieron eliminar los movimientos de cuenta');
    }

    const { error: deleteError } = await supabaseAdmin
      .from('invoices')
      .delete()
      .eq('id', invoiceId);

    if (deleteError) {
      throw new Error('No se pudo eliminar la factura');
    }

    await recomputeBalances(invoice.clientId);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    console.error('[DELETE /api/billing/invoices/:id]', error);
    const message = error instanceof Error ? error.message : 'Error al eliminar la factura';
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};

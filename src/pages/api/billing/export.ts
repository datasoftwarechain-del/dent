import type { APIRoute } from 'astro';
import { getBillableOrdersForExport } from '@/server/services/billing-report-service';
import { canRunBilling } from '@/server/auth/permissions';

const csvEscape = (value: string) => {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user?.id) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  if (!canRunBilling(user)) {
    return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  try {
    const rows = await getBillableOrdersForExport();
    const header = ['id', 'code', 'amount', 'status', 'debtor'];
    const csvLines = [
      header.join(','),
      ...rows.map((row) =>
        [
          csvEscape(row.id),
          csvEscape(row.code),
          csvEscape(row.amount),
          csvEscape(row.status),
          csvEscape(row.debtor)
        ].join(',')
      )
    ];

    const csv = csvLines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    const filename = `billing-${date}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (error) {
    console.error('[billing/export] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
};

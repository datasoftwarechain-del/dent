/** @jsxImportSource astro */
import { addAttribute, createComponent, renderTemplate } from 'astro/runtime/server/index.js';

type ClientOption = {
  id: string;
  name: string | null;
  email: string | null;
};

type StatementRow = {
  fecha: string;
  tipo: string;
  compNro: string;
  ordenId: string | null;
  detalle: string;
  paciente: string;
  facturas: number;
  entregas: number;
  saldoAcumulado: number;
};

type StatementTotals = {
  facturas: number;
  entregas: number;
  saldo: number;
};

type StatementPayload = {
  client: {
    id: string;
    name: string;
  };
  rows: StatementRow[];
  totals: StatementTotals;
};

type ClientStatementsProps = {
  clients: ClientOption[];
  selectedClientId: string;
  statement: StatementPayload | null;
  error?: string | null;
};

const currencyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2
});

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

const formatCurrency = (value: number) => currencyFormatter.format(value);
const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return dateFormatter.format(date);
};

const emptyStatement = {
  facturas: 0,
  entregas: 0,
  saldo: 0
};

const ClientStatements = createComponent(($$result, $$props) => {
  const {
    clients = [],
    selectedClientId = '',
    statement = null,
    error = null
  } = $$props as ClientStatementsProps;

  const hasSelection = Boolean(selectedClientId);
  const totals = statement?.totals ?? emptyStatement;
  const sortedRows = statement
    ? [...statement.rows].sort(
        (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
      )
    : [];

  return renderTemplate`
    <section class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-primary/5">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 class="text-lg font-semibold text-white">Estado de cuenta</h1>
          <p class="text-sm text-slate-400">
            Selecciona un cliente para revisar sus movimientos y entregas.
          </p>
        </div>
        <form method="get" data-client-filter class="flex w-full max-w-md items-center gap-3">
          <label class="sr-only" for="billing-client">Cliente</label>
          <select
            id="billing-client"
            name="clientId"
            class="flex-1 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
            ${addAttribute(selectedClientId, 'value')}
          >
            <option value="">Selecciona un cliente...</option>
            ${clients.map((client) => {
              const displayName = client.name ?? client.email ?? client.id;
              return renderTemplate`<option
                ${addAttribute(client.id, 'value')}
                ${addAttribute(client.id === selectedClientId, 'selected')}
              >${displayName}</option>`;
            })}
          </select>
          <button
            type="submit"
            class="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-accent hover:text-accent"
          >
            Ver
          </button>
        </form>
      </div>
    </section>

    <script type="module" is:inline>
      const filterForm = document.querySelector('[data-client-filter]');
      if (filterForm instanceof HTMLFormElement) {
        const select = filterForm.querySelector('select[name="clientId"]');
        if (select instanceof HTMLSelectElement) {
          select.addEventListener('change', () => {
            filterForm.requestSubmit();
          });
        }
      }
    </script>

    ${error ? renderTemplate`
      <div class="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        ${error}
      </div>
    ` : ''}

    ${hasSelection && !statement && !error ? renderTemplate`
      <div class="mt-6 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-5 text-sm text-slate-300">
        No se encontraron movimientos para el cliente seleccionado.
      </div>
    ` : ''}

    ${hasSelection && statement ? renderTemplate`
      <section class="mt-6 grid gap-4 md:grid-cols-3">
        <div class="rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-inner shadow-black/20">
          <p class="text-xs uppercase tracking-wide text-slate-400">Facturado</p>
          <p class="mt-1 text-2xl font-semibold text-white">${formatCurrency(totals.facturas)}</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-inner shadow-black/20">
          <p class="text-xs uppercase tracking-wide text-slate-400">Entregado</p>
          <p class="mt-1 text-2xl font-semibold text-white">${formatCurrency(totals.entregas)}</p>
        </div>
        <div class="rounded-2xl border border-white/10 bg-slate-950/70 p-4 shadow-inner shadow-black/20">
          <p class="text-xs uppercase tracking-wide text-slate-400">Saldo</p>
          <p class="mt-1 text-2xl font-semibold ${totals.saldo > 0 ? 'text-amber-300' : totals.saldo < 0 ? 'text-emerald-300' : 'text-slate-200'}">
            ${formatCurrency(totals.saldo)}
          </p>
        </div>
      </section>

      <section class="mt-6 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-primary/5">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="text-base font-semibold text-white">Movimientos</h2>
            <p class="text-sm text-slate-400">
              Detalle cronologico de facturas y entregas registrados.
            </p>
          </div>
        </div>

        <div class="mt-4 overflow-x-auto">
          <table class="min-w-full divide-y divide-white/10 text-sm text-slate-200">
            <thead class="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th class="px-4 py-3">Fecha</th>
                <th class="px-4 py-3">Tipo</th>
                <th class="px-4 py-3">Referencia</th>
                <th class="px-4 py-3">Detalle</th>
                <th class="px-4 py-3">Paciente</th>
                <th class="px-4 py-3 text-right">Facturas</th>
                <th class="px-4 py-3 text-right">Entregas</th>
                <th class="px-4 py-3 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/10">
              ${sortedRows.length === 0 ? renderTemplate`
                <tr>
                  <td ${addAttribute(8, 'colSpan')} class="px-4 py-6 text-center text-sm text-slate-400">
                    Aun no hay movimientos registrados para este cliente.
                  </td>
                </tr>
              ` : ''}
              ${sortedRows.map((row) => renderTemplate`
                <tr class="hover:bg-white/5">
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-slate-300">${formatTimestamp(row.fecha)}</td>
                  <td class="px-4 py-3 font-semibold text-white">${row.tipo}</td>
                  <td class="px-4 py-3">${row.compNro || '-'}</td>
                  <td class="px-4 py-3">${row.detalle}</td>
                  <td class="px-4 py-3">${row.paciente}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-right text-amber-200">${row.facturas ? formatCurrency(row.facturas) : '-'}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-right text-emerald-200">${row.entregas ? formatCurrency(row.entregas) : '-'}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-right text-slate-300">${formatCurrency(row.saldoAcumulado)}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </section>
    ` : ''}
  `;
});

export default ClientStatements;

/** @jsxImportSource astro */
import {
  createAstro,
  createComponent,
  maybeRenderHead,
  renderComponent,
  renderTemplate
} from 'astro/runtime/server/index.js';
import AppLayout from '@/layouts/AppLayout.astro';
import ClientStatements from '@/components/ClientStatements.tsx';
import { supabaseAdmin } from '@/server/db/client';
import { getStatementByClient } from '@/server/services/billing-service';
import { isAdmin } from '@/server/auth/permissions';

type StatementPayload = Awaited<ReturnType<typeof getStatementByClient>>;
type ClientOption = {
  id: string;
  name: string | null;
  email: string | null;
};

const baseAstro = createAstro();

const BillingDashboard = createComponent(async ($$result, $$props, $$slots) => {
  const Astro = $$result.createAstro(baseAstro, $$props, $$slots);
  Astro.self = BillingDashboard;

  const user = Astro.locals.user;
  if (!user) {
    return Astro.redirect('/login');
  }

  if (!isAdmin(user)) {
    return new Response('Forbidden', { status: 403 });
  }

  const { data: clients = [] } = await supabaseAdmin
    .from('user_profiles')
    .select('id,name,email')
    .eq('role', 'CLIENT')
    .order('name', { ascending: true })
    .order('email', { ascending: true });

  const normalizedClients: ClientOption[] = clients.map((client) => ({
    id: client.id,
    name: client.name,
    email: client.email
  }));

  const selectedClientId = Astro.url.searchParams.get('clientId') ?? '';

  let statement: StatementPayload | null = null;
  let statementError: string | null = null;

  if (selectedClientId) {
    try {
      statement = await getStatementByClient(selectedClientId);
    } catch (error) {
      statementError =
        error instanceof Error ? error.message : 'No se pudo obtener el estado de cuenta';
    }
  }

  return renderTemplate`${renderComponent($$result, 'AppLayout', AppLayout, {
    title: 'Facturacion',
    description: 'Gestiona estados de cuenta y entregas de clientes.',
    user
  }, {
    default: ($$result2) => renderTemplate`
      ${maybeRenderHead()}
      ${renderComponent($$result2, 'ClientStatements', ClientStatements, {
        clients: normalizedClients,
        selectedClientId,
        statement,
        error: statementError
      })}
    `
  })}`;
});

export { BillingDashboard };
export default BillingDashboard;

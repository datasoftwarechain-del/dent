import type { APIContext, MiddlewareNext } from 'astro';
import { getSession } from './server/auth/session';

const PUBLIC_PREFIXES = [
  '/login',
  '/register',
  '/logout',
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/public',
  '/assets',
  '/favicon.ico',
  '/robots.txt',
  '/', // landing raíz
];

function isPublic(pathname: string) {
  // permite todo lo que empiece por prefix público
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Rutas sólo ADMIN
const ADMIN_PREFIXES = ['/app/billing', '/api/billing', '/app/leads', '/api/leads'];
function needsAdmin(pathname: string) {
  return ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function onRequest(context: APIContext, next: MiddlewareNext) {
  console.log('Middleware executed for path:', context.url.pathname);
  const { url, request, cookies, locals, redirect } = context;
  const pathname = new URL(url).pathname;
  const isPublicPath = isPublic(pathname);

  // Cargar sesión para tener locals disponibles incluso en páginas públicas
  const session = await getSession({ cookies });
  locals.user = session?.user ?? null;
  locals.userId = session?.user?.id ?? null;

  if (!locals.user) {
    if (isPublicPath) {
      return next();
    }
    return redirect(`/login?next=${encodeURIComponent(pathname)}`, 303);
  }

  // Guard de admin
  if (needsAdmin(pathname) && locals.user.role !== 'ADMIN') {
    return new Response('No autorizado', { status: 403 });
  }

  return next();
}

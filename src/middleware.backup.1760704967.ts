import type { MiddlewareHandler } from 'astro';
import { lucia } from '@/server/auth';
import { logger } from '@/server/logger';

export const onRequest: MiddlewareHandler = async (context, next) => {
  const sessionCookie = context.cookies.get(lucia.sessionCookieName);
  const bearer = context.request.headers.get('authorization');
  const sessionId =
    sessionCookie?.value ?? (bearer ? lucia.readBearerToken(bearer) : null);

  try {
    const result = sessionId ? await lucia.validateSession(sessionId) : { session: null, user: null };

    context.locals.user = result.user ?? null;
    context.locals.session = result.session ?? null;

    if (result.session && result.session.fresh) {
      const cookie = lucia.createSessionCookie(result.session.id);
      context.cookies.set(cookie.name, cookie.value, cookie.attributes);
    }

    if (!result.session && sessionCookie) {
      const blank = lucia.createBlankSessionCookie();
      context.cookies.set(blank.name, blank.value, blank.attributes);
    }
  } catch (error) {
    logger.warn({ error }, 'Session validation failed');
    const blank = lucia.createBlankSessionCookie();
    context.cookies.set(blank.name, blank.value, blank.attributes);
    context.locals.user = null;
    context.locals.session = null;
  }

  return next();
};

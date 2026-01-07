import type { APIRoute } from 'astro';

export const parseJson = async <T>(request: Request) => {
  const body = await request.text();

  if (!body) {
    return {} as T;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error('Cuerpo JSON inválido');
  }
};

export const json = <T>(data: T, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
};

export const withErrorHandling = (handler: APIRoute): APIRoute => {
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      console.error('API Error', error);
      return json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unexpected error'
        },
        { status: 500 }
      );
    }
  };
};

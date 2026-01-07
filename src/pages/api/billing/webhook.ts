import type { APIRoute } from 'astro';
import { json } from '@/server/utils/http';
import { verifyStripeSignature } from '@/server/payments/stripe';
import { logger } from '@/server/logger';

export const POST: APIRoute = async ({ request }) => {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return json(
      {
        ok: false,
        error: 'Cabecera stripe-signature ausente'
      },
      { status: 400 }
    );
  }

  const payload = await request.text();

  try {
    const event = verifyStripeSignature(payload, signature);
    logger.info({ type: event.type }, '[billing/webhook] evento recibido');

    return json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno';

    if (message.toLowerCase().includes('signature')) {
      return json(
        {
          ok: false,
          error: 'Error en la firma del webhook'
        },
        { status: 400 }
      );
    }

    logger.error({ error }, '[billing/webhook] error');
    return json(
      {
        ok: false,
        error: message
      },
      { status: 500 }
    );
  }
};

import { z } from 'zod';
import { supabaseAdmin } from '@/server/db/client';
import { logger } from '@/server/logger';
import { WorkOrderStatus } from '@/server/db/types';

const deliveryPayloadSchema = z.object({
  orderCode: z.string().min(1),
  deliveredAt: z
    .union([z.string(), z.number(), z.date()])
    .transform((value) => {
      if (value instanceof Date) return value;
      if (typeof value === 'number') {
        return new Date(value);
      }
      const numericTimestamp = Number(value);
      if (!Number.isNaN(numericTimestamp) && numericTimestamp > 0) {
        return new Date(numericTimestamp * (numericTimestamp < 10_000_000_000 ? 1000 : 1));
      }
      return new Date(value);
    })
    .refine((date) => !Number.isNaN(date.getTime()), 'Invalid delivery timestamp'),
  notes: z.string().max(500).optional(),
  whatsappMessageId: z.string().optional()
});

export type WhatsAppDeliveryPayload = z.infer<typeof deliveryPayloadSchema>;

const whatsappEnvelopeSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z.array(
          z.object({
            value: z.object({
              messages: z
                .array(
                  z.object({
                    id: z.string(),
                    from: z.string(),
                    timestamp: z.string(),
                    type: z.string(),
                    text: z
                      .object({
                        body: z.string()
                      })
                      .optional()
                  })
                )
                .optional()
            })
          })
        )
      })
    )
    .nonempty()
});

const DELIVERY_CODE_REGEX = /(?:entrega|entregado|#entrega)\s+(?:orden\s+)?([A-Z0-9_-]+)/i;

const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8'
};

const toDeliveryFromMessage = (messageBody: string | undefined, timestamp: string, messageId: string) => {
  const body = messageBody?.trim();
  if (!body) return null;
  const match = DELIVERY_CODE_REGEX.exec(body);
  if (!match) return null;
  const [, orderCode] = match;
  const tsNumber = Number(timestamp);
  const deliveredAt = Number.isFinite(tsNumber)
    ? new Date(tsNumber * (tsNumber < 10_000_000_000 ? 1000 : 1))
    : new Date();

  if (Number.isNaN(deliveredAt.getTime())) {
    return null;
  }

  return {
    orderCode: orderCode.toUpperCase(),
    deliveredAt,
    notes: body,
    whatsappMessageId: messageId
  } satisfies WhatsAppDeliveryPayload;
};

const extractDeliveriesFromEnvelope = (payload: unknown): WhatsAppDeliveryPayload[] => {
  const parsed = whatsappEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }

  const deliveries: WhatsAppDeliveryPayload[] = [];

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages ?? [];
      for (const message of messages) {
        const candidate = toDeliveryFromMessage(message.text?.body, message.timestamp, message.id);
        if (candidate) {
          deliveries.push(candidate);
        }
      }
    }
  }

  return deliveries;
};

export const verifyWhatsAppSignature = (
  suppliedSignature: string | null,
  body: string,
  signingSecret: string | undefined
): boolean => {
  if (!signingSecret) {
    logger.warn('WhatsApp webhook secret not configured; skipping signature validation');
    return true;
  }
  if (!suppliedSignature) {
    return false;
  }
  // TODO: calcular el hash HMAC SHA256 y compararlo con suppliedSignature.
  logger.debug('WhatsApp signature verification stub executed');
  return true;
};

export const recordDeliveryFromWebhook = async (input: WhatsAppDeliveryPayload) => {
  const payload = deliveryPayloadSchema.parse(input);

  const { data: order, error: orderError } = await supabaseAdmin
    .from('work_orders')
    .select('id,status')
    .or(`displayCode.eq.${payload.orderCode},code.eq.${payload.orderCode}`)
    .maybeSingle();

  if (orderError) {
    logger.error({ error: orderError }, 'WhatsApp delivery lookup failed');
    return { ok: false as const, reason: 'order_lookup_failed' as const };
  }

  if (!order) {
    logger.warn({ orderCode: payload.orderCode }, 'WhatsApp delivery ignored: order not found');
    return { ok: false as const, reason: 'order_not_found' as const };
  }

  const alreadyDelivered = order.status === WorkOrderStatus.DELIVERED;
  const deliveryEvent = {
    workOrderId: order.id,
    type: 'WORK_ORDER_DELIVERY_CONFIRMED',
    message: payload.notes ?? 'Entrega confirmada via WhatsApp',
    metadata: {
      whatsappMessageId: payload.whatsappMessageId ?? null,
      deliveredAt: payload.deliveredAt.toISOString(),
      duplicate: alreadyDelivered
    }
  } as const;

  if (alreadyDelivered) {
    await supabaseAdmin.from('work_order_events').insert(deliveryEvent);

    return {
      ok: true as const,
      workOrderId: order.id,
      alreadyDelivered: true as const
    };
  }

  const { error: updateError } = await supabaseAdmin
    .from('work_orders')
    .update({ status: WorkOrderStatus.DELIVERED })
    .eq('id', order.id);

  if (updateError) {
    logger.error({ error: updateError }, 'WhatsApp delivery update failed');
    return { ok: false as const, reason: 'order_update_failed' as const };
  }

  await supabaseAdmin.from('work_order_events').insert(deliveryEvent);

  return {
    ok: true as const,
    workOrderId: order.id,
    alreadyDelivered: false as const
  };
};

export const handleWhatsAppWebhookRequest = async (request: Request) => {
  let bodyText = '';
  try {
    bodyText = await request.text();
  } catch (error) {
    logger.error({ error }, 'Unable to read WhatsApp webhook body');
    return new Response(
      JSON.stringify({ ok: false, error: 'invalid_body' }),
      { status: 400, headers: responseHeaders }
    );
  }

  const signatureValid = verifyWhatsAppSignature(
    request.headers.get('x-hub-signature-256'),
    bodyText,
    process.env.WHATSAPP_WEBHOOK_SECRET
  );

  if (!signatureValid) {
    return new Response(
      JSON.stringify({ ok: false, error: 'invalid_signature' }),
      { status: 401, headers: responseHeaders }
    );
  }

  let parsed: unknown;
  try {
    parsed = bodyText.length ? JSON.parse(bodyText) : {};
  } catch (error) {
    logger.error({ error }, 'WhatsApp webhook arrived with invalid JSON');
    return new Response(
      JSON.stringify({ ok: false, error: 'invalid_json' }),
      { status: 400, headers: responseHeaders }
    );
  }

  const directDelivery = deliveryPayloadSchema.safeParse(parsed);
  const deliveries: WhatsAppDeliveryPayload[] = directDelivery.success
    ? [directDelivery.data]
    : extractDeliveriesFromEnvelope(parsed);

  if (deliveries.length === 0) {
    logger.info('WhatsApp webhook received without delivery markers');
    return new Response(
      JSON.stringify({ ok: true, results: [] }),
      { status: 202, headers: responseHeaders }
    );
  }

  const results = [] as Array<{ orderCode: string; ok: boolean; reason?: string }>;

  for (const delivery of deliveries) {
    try {
      const outcome = await recordDeliveryFromWebhook(delivery);
      results.push({
        orderCode: delivery.orderCode,
        ok: outcome.ok,
        reason: outcome.ok ? (outcome.alreadyDelivered ? 'already_delivered' : undefined) : outcome.reason
      });
    } catch (error) {
      logger.error({ error, delivery }, 'Failed to persist WhatsApp delivery event');
      results.push({ orderCode: delivery.orderCode, ok: false, reason: 'unexpected_error' });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, results }),
    { status: 200, headers: responseHeaders }
  );
};

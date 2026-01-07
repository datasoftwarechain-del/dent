import { env } from '../config';
import { logger } from '../logger';

type WhatsAppParams = {
  to: string;
  body: string;
  mediaUrl?: string | null;
};

export type WhatsAppResult = {
  sent: boolean;
  skipped?: boolean;
  error?: string;
};

const hasTwilioConfig = () =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM);

const normalizePhone = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
};

export const sendWhatsAppMessage = async (params: WhatsAppParams): Promise<WhatsAppResult> => {
  if (!hasTwilioConfig()) {
    logger.debug('Twilio WhatsApp not configured. Skipping message.');
    return { sent: false, skipped: true, error: 'twilio-not-configured' };
  }

  const accountSid = env.TWILIO_ACCOUNT_SID!;
  const authToken = env.TWILIO_AUTH_TOKEN!;
  const from = normalizePhone(env.TWILIO_WHATSAPP_FROM!);
  const to = normalizePhone(params.to);

  if (!to) {
    logger.warn('WhatsApp recipient missing. Skipping send.');
    return { sent: false, skipped: true, error: 'missing-recipient' };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: to,
      From: from,
      Body: params.body
    });

    if (params.mediaUrl) {
      body.append('MediaUrl', params.mediaUrl);
    }

    const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      logger.error(
        { status: response.status, errorText },
        'Failed to send WhatsApp message through Twilio'
      );
      return { sent: false, error: `twilio-error-${response.status}` };
    }

    logger.info({ to }, 'WhatsApp message sent via Twilio');
    return { sent: true };
  } catch (error) {
    logger.error({ error }, 'Unexpected error when sending WhatsApp message');
    const message = error instanceof Error ? error.message : 'unknown-error';
    return { sent: false, error: message };
  }
};


import nodemailer from 'nodemailer';
import type { SendMailOptions, Transporter } from 'nodemailer';
import { env } from '../config';
import { logger } from '../logger';

let transporter: Transporter | null = null;

const createTransporter = () => {
  if (transporter) {
    return transporter;
  }

  try {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? {
              user: env.SMTP_USER,
              pass: env.SMTP_PASS
            }
          : undefined
    });

    return transporter;
  } catch (error) {
    logger.warn(
      {
        error
      },
      'Failed to create SMTP transporter. Email notifications will be disabled.'
    );

    transporter = null;
    return null;
  }
};

export const sendEmail = async (message: SendMailOptions) => {
  const transport = createTransporter();

  if (!transport) {
    logger.warn('SMTP not configured. Skipping email.');
    return;
  }

  try {
    await transport.sendMail({
      from: 'DigitalDent <no-reply@digitaldent.app>',
      ...message
    });

    logger.info(
      {
        to: message.to,
        subject: message.subject
      },
      'Email sent'
    );
  } catch (error) {
    logger.error(
      {
        error,
        subject: message.subject,
        to: message.to
      },
      'Failed to send email'
    );
    throw error;
  }
};

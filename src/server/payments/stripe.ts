import Stripe from 'stripe';
import { env } from '../config';
import { logger } from '../logger';

let stripe: Stripe | null = null;

const getStripe = () => {
  if (stripe) return stripe;

  if (!env.STRIPE_SECRET_KEY) {
    logger.warn('Stripe not configured. Payments will be disabled.');
    return null;
  }

  stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-04-10'
  });

  return stripe;
};

export const createCheckoutSession = async (payload: Stripe.Checkout.SessionCreateParams) => {
  const client = getStripe();
  if (!client) {
    throw new Error('Stripe not configured');
  }

  return client.checkout.sessions.create(payload);
};

export const createPaymentIntent = async (payload: Stripe.PaymentIntentCreateParams) => {
  const client = getStripe();
  if (!client) {
    throw new Error('Stripe not configured');
  }

  return client.paymentIntents.create(payload);
};

export const verifyStripeSignature = (payload: string | Buffer, signature: string) => {
  const client = getStripe();
  if (!client || !env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('Stripe webhook not configured');
  }

  return client.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
};

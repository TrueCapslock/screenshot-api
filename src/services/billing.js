import Stripe from 'stripe';
import config from '../config.js';

let stripe;

export function getStripe() {
  if (!stripe) {
    if (!config.stripe.secretKey) {
      throw new Error('Stripe secret key not configured. Set STRIPE_SECRET_KEY in .env');
    }
    stripe = new Stripe(config.stripe.secretKey);
  }
  return stripe;
}

export async function createCheckoutSession({ userId, email, priceId, successUrl, cancelUrl }) {
  const s = getStripe();
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId },
    success_url: successUrl || `${config.baseUrl}/account?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${config.baseUrl}/pricing`,
    subscription_data: {
      metadata: { userId },
    },
  });

  return session;
}

export async function createCustomerPortalSession(customerId, returnUrl) {
  const s = getStripe();
  return s.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || `${config.baseUrl}/account`,
  });
}

export function constructWebhookEvent(payload, signature) {
  const s = getStripe();
  return s.webhooks.constructEvent(payload, signature, config.stripe.webhookSecret);
}

function tierFromPriceId(priceId) {
  const map = {
    [config.stripe.prices.starter]: 'starter',
    [config.stripe.prices.pro]: 'pro',
    [config.stripe.prices.business]: 'business',
  };
  return map[priceId] || 'free';
}

export async function handleSubscriptionEvent(event) {
  const subscription = event.data.object;
  const userId = subscription.metadata?.userId;

  if (!userId) return;

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const tier = tierFromPriceId(priceId);

  const db = (await import('../db/knex.js')).default;

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.updated':
    case 'customer.subscription.created':
      await db('users').where({ id: userId }).update({
        tier,
        stripe_customer_id: subscription.customer,
        stripe_subscription_id: subscription.id,
        updated_at: db.fn.now(),
      });
      break;

    case 'customer.subscription.deleted':
      await db('users').where({ id: userId }).update({
        tier: 'free',
        stripe_subscription_id: null,
        updated_at: db.fn.now(),
      });
      break;
  }
}

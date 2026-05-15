import { Router } from 'express';
import {
  getStripe,
  createCheckoutSession,
  createCustomerPortalSession,
  constructWebhookEvent,
  handleSubscriptionEvent,
} from '../services/billing.js';
import { auth } from '../middleware/auth.js';
import db from '../db/knex.js';
import config from '../config.js';

const router = Router();

const PRICE_MAP = {
  starter: config.stripe.prices.starter,
  pro: config.stripe.prices.pro,
  business: config.stripe.prices.business,
};

const FALLBACK_PRICES = {
  free: { amount: 0, currency: 'usd', interval: 'month', screenshots: '10', reqMin: 5 },
  starter: { amount: 900, currency: 'usd', interval: 'month', screenshots: '500', reqMin: 60 },
  pro: { amount: 2900, currency: 'usd', interval: 'month', screenshots: '2500', reqMin: 250 },
  business: { amount: 9900, currency: 'usd', interval: 'month', screenshots: '15000', reqMin: 1000 },
};

router.get('/stripe/prices', async (req, res) => {
  const tiers = ['free', 'starter', 'pro', 'business'];
  const tierConfig = config.tiers;

  if (!config.stripe.secretKey || !Object.values(config.stripe.prices).some(Boolean)) {
    return res.json({
      prices: tiers.map((tier) => ({
        tier,
        price_id: null,
        ...FALLBACK_PRICES[tier],
        monthly_limit: tierConfig[tier]?.monthlyLimit || 10,
        rate_limit: tierConfig[tier]?.rateLimit || 5,
        rate_window_ms: tierConfig[tier]?.windowMs || 60_000,
      })),
    });
  }

  try {
    const s = getStripe();
    const results = await Promise.all(
      Object.entries(config.stripe.prices).map(async ([tier, priceId]) => {
        try {
          const price = await s.prices.retrieve(priceId, { expand: ['product'] });
          return {
            tier,
            price_id: price.id,
            amount: price.unit_amount || 0,
            currency: price.currency,
            interval: price.recurring?.interval || 'month',
            screenshots: String(tierConfig[tier]?.monthlyLimit || 0),
            reqMin: tierConfig[tier]?.rateLimit || 0,
            monthly_limit: tierConfig[tier]?.monthlyLimit || 0,
            rate_limit: tierConfig[tier]?.rateLimit || 0,
            rate_window_ms: tierConfig[tier]?.windowMs || 60_000,
          };
        } catch {
          return null;
        }
      }),
    );

    const validPrices = results.filter(Boolean);
    validPrices.unshift({
      tier: 'free',
      price_id: null,
      ...FALLBACK_PRICES.free,
      monthly_limit: tierConfig.free?.monthlyLimit || 10,
      rate_limit: tierConfig.free?.rateLimit || 5,
      rate_window_ms: tierConfig.free?.windowMs || 60_000,
    });

    res.json({ prices: validPrices });
  } catch {
    res.json({
      prices: tiers.map((tier) => ({
        tier,
        price_id: null,
        ...FALLBACK_PRICES[tier],
        monthly_limit: tierConfig[tier]?.monthlyLimit || 10,
        rate_limit: tierConfig[tier]?.rateLimit || 5,
        rate_window_ms: tierConfig[tier]?.windowMs || 60_000,
      })),
    });
  }
});

router.post('/stripe/checkout', auth, async (req, res) => {
  const { priceId, successUrl, cancelUrl } = req.body;

  if (!priceId) {
    return res.status(400).json({ error: 'validation_error', message: 'priceId is required' });
  }

  const resolvedPriceId = PRICE_MAP[priceId] || priceId;

  const validPrices = Object.values(config.stripe.prices).filter(Boolean);
  if (validPrices.length > 0 && !validPrices.includes(resolvedPriceId)) {
    return res.status(400).json({
      error: 'not_configured',
      message: 'Stripe billing not configured. Set price IDs in .env',
    });
  }

  if (!config.stripe.secretKey) {
    return res.status(400).json({
      error: 'not_configured',
      message: 'Stripe billing not configured. Set STRIPE_SECRET_KEY in .env',
    });
  }

  try {
    const user = await db('users').where({ id: req.apiKey.userId }).select('email').first();
    const session = await createCheckoutSession({
      userId: req.apiKey.userId,
      email: user?.email,
      priceId: resolvedPriceId,
      successUrl,
      cancelUrl,
    });

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'checkout_failed', message: err.message || 'Failed to create checkout session' });
  }
});

router.post('/stripe/portal', auth, async (req, res) => {
  try {
    const user = await db('users').where({ id: req.apiKey.userId }).select('stripe_customer_id').first();
    if (!user?.stripe_customer_id) {
      return res.status(400).json({ error: 'no_subscription', message: 'No active subscription' });
    }

    const session = await createCustomerPortalSession(user.stripe_customer_id, req.body.returnUrl);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'portal_failed', message: 'Failed to create portal session' });
  }
});

router.post(/^\/stripe\/webhook\/?$/, async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).json({ error: 'missing_signature', message: 'stripe-signature header required' });
  }

  try {
    const event = constructWebhookEvent(req.body, sig);
    await handleSubscriptionEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(400).json({ error: 'webhook_error', message: err.message });
  }
});

export default router;

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

export default {
  version: pkg.version,

  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  env: process.env.NODE_ENV || 'development',

  db: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/screenshot_api',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: {
      starter: process.env.STRIPE_STARTER_PRICE_ID || '',
      pro: process.env.STRIPE_PRO_PRICE_ID || '',
      business: process.env.STRIPE_BUSINESS_PRICE_ID || '',
    },
  },

  storage: {
    endpoint: process.env.STORAGE_ENDPOINT || '',
    region: process.env.STORAGE_REGION || '',
    bucket: process.env.STORAGE_BUCKET || '',
    accessKey: process.env.STORAGE_ACCESS_KEY || '',
    secretKey: process.env.STORAGE_SECRET_KEY || '',
    localDir: process.env.LOCAL_STORAGE_DIR || './screenshots',
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },

  resendKey: process.env.RESEND_KEY || '',

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  aiProvider: process.env.AI_PROVIDER || 'gemini',
  hfApiToken: process.env.HF_API_TOKEN || '',

  adminEmail: process.env.ADMIN_EMAIL || '',

  screenshotRetentionHours: parseInt(process.env.SCREENSHOT_RETENTION_HOURS || '24', 10),

  tiers: {
    free: { monthlyLimit: 10, rateLimit: 5, windowMs: 60_000 },
    starter: { monthlyLimit: 500, rateLimit: 60, windowMs: 60_000 },
    pro: { monthlyLimit: 2500, rateLimit: 250, windowMs: 60_000 },
    business: { monthlyLimit: 15000, rateLimit: 1000, windowMs: 60_000 },
  },
};

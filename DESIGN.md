# Screenshot API — Design Document

## Overview

REST API for capturing, comparing, and describing screenshots of web pages and HTML content. Serves a bilingual (English/Norwegian) SPA dashboard and supports subscription billing via Stripe.

---

## Architecture

```
┌──────────┐     ┌──────────────┐     ┌────────────┐
│  Browser │────▶│  Express App │────▶│ PostgreSQL │
│ (SPA)    │     │  (src/)      │     └────────────┘
└──────────┘     │              │     ┌────────────┐
                 │  Middleware  │────▶│ Redis      │
                 │  chain       │     │ (rate      │
                 └──────┬───────┘     │  limit +   │
                        │             │  cache +   │
                 ┌──────▼───────┐     │  BullMQ)   │
                 │  BullMQ      │     └────────────┘
                 │  Worker      │
                 │  (renderer)  │
                 └──────┬───────┘
                        │
                 ┌──────▼───────┐
                 │  Playwright  │
                 │  Chromium    │
                 └──────────────┘
```

### Process Model

| Process | Command | Purpose |
|---------|---------|---------|
| App | `node src/index.js` | Express server — serves API + dashboard |
| Worker | `node src/workers/renderer.js` | BullMQ consumer — runs Playwright |
| Cleanup | Runs in app process | 15-min interval, deletes old screenshots |

---

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | — | DB + Redis health check |
| `POST` | `/v1/signup` | — | Create account + API key |
| `POST` | `/v1/magic-link` | — | Send magic login link |
| `GET` | `/v1/verify-magic` | — | Verify magic token, redirect with key |
| `POST` | `/v1/session` | key/token | Create session |
| `POST` | `/v1/session/key` | session | Switch active key for session |
| `DELETE` | `/v1/session` | session | End session |
| `GET` | `/v1/account` | key/session | User profile, usage, keys, limits |
| `GET` | `/v1/account/screenshots` | key/session | Paginated screenshot history |
| `GET` | `/v1/account/recent-urls` | key/session | Last 10 unique URLs |
| `GET` | `/v1/keys` | key/session | List API keys |
| `POST` | `/v1/keys` | key/session | Create API key |
| `DELETE` | `/v1/keys/:id` | key/session | Revoke API key |
| `POST` | `/v1/screenshot` | key + rate | Capture URL screenshot (sync) |
| `POST` | `/v1/html` | key + rate | Render HTML to image (sync) |
| `POST` | `/v1/screenshot/async` | key + rate | Queue async screenshot |
| `GET` | `/v1/screenshot/:id` | key/session | Poll async result |
| `POST` | `/v1/screenshot/:id/retry` | key/session | Retry failed screenshot |
| `DELETE` | `/v1/screenshot/:id` | key/session | Delete screenshot |
| `POST` | `/v1/screenshot/:id/baseline` | key/session | Promote to baseline |
| `GET` | `/v1/screenshot/:id/baseline` | key/session | Get baseline image |
| `GET` | `/v1/screenshot/:id/diff` | key/session | Get diff image |
| `GET` | `/v1/screenshot/:id/describe` | key/session | AI describe diff (Pro+) |
| `POST` | `/v1/compare` | key + rate | Compare against baseline |
| `GET` | `/v1/stripe/prices` | — | List prices (from Stripe or fallback) |
| `POST` | `/v1/stripe/checkout` | key/session | Create checkout session |
| `POST` | `/v1/stripe/portal` | key/session | Customer portal URL |
| `POST` | `/v1/stripe/webhook` | — | Stripe subscription events |
| `GET` | `/v1/admin/users` | admin | List all users |
| `GET` | `/v1/admin/users/:id` | admin | Get user + keys |
| `PATCH` | `/v1/admin/users/:id` | admin | Update name/tier |
| `DELETE` | `/v1/admin/users/:id` | admin | Delete user + cascade |
| `POST` | `/v1/admin/users/:id/keys` | admin | Create key for user |
| `DELETE` | `/v1/admin/keys/:id` | admin | Revoke any key |

---

## Middleware Pipeline

```
request
  │
  ▼
helmet ───────────────────── security headers
  │
  ▼
cors ─────────────────────── cross-origin
  │
  ▼
version header ───────────── X-API-Version
  │
  ▼
static files ─────────────── /docs → public/
  │
  ▼
Swagger UI ───────────────── /docs/api
  │
  ▼
express.raw ──────────────── POST /v1/stripe/webhook only
  │
  ▼
express.json ─────────────── all other routes
  │
  ▼
auth ─────────────────────── per-route (key or session)
  │
  ▼
admin ────────────────────── per-route (isAdmin check)
  │
  ▼
rateLimit ────────────────── per-route (Redis sliding window)
  │
  ▼
route handler ────────────── business logic
  │
  ▼
logUsage ─────────────────── on finish (async write to usage_logs)
  │
  ▼
errorHandler ─────────────── catches thrown errors
```

---

## Database Schema

### `users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `email` | `varchar(255)` | UNIQUE, NOT NULL |
| `name` | `varchar(255)` | nullable |
| `tier` | `varchar(50)` | `'free'`, `'starter'`, `'pro'`, `'business'` |
| `stripe_customer_id` | `varchar(255)` | nullable |
| `stripe_subscription_id` | `varchar(255)` | nullable |
| `created_at` / `updated_at` | `timestamp` | |

### `api_keys`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `users(id)` ON DELETE CASCADE |
| `key_hash` | `varchar(255)` | bcrypt of full key |
| `key_prefix` | `varchar(10)` | first 8 chars (`sk_...`) |
| `name` | `varchar(255)` | human label |
| `active` | `boolean` | default `true` |
| `last_used_at` | `timestamp` | updated on auth |

### `sessions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `token` | `varchar(128)` | UNIQUE, random |
| `user_id` | `uuid` | FK → `users(id)` ON DELETE CASCADE |
| `api_key_id` | `uuid` | FK → `api_keys(id)` ON DELETE CASCADE |

### `screenshots`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `api_key_id` | `uuid` | FK → `api_keys(id)` ON DELETE CASCADE |
| `url` | `text` | source URL or `'html://inline'` |
| `options` | `jsonb` | width, height, mobile, fullPage, etc. |
| `format` | `varchar(10)` | `png`, `jpeg`, `webp` |
| `storage_path` | `varchar(500)` | file location |
| `bytes` | `integer` | file size |
| `status` | `varchar(20)` | `pending`, `processing`, `completed`, `failed` |
| `is_baseline` | `boolean` | promoted as comparison reference |
| `baseline_id` | `uuid` | FK → `screenshots(id)` ON DELETE SET NULL |
| `diff_percentage` | `float` | last comparison result |
| `diff_storage_path` | `varchar(500)` | diff image file |

### `usage_logs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `api_key_id` | `uuid` | FK → `api_keys(id)` ON DELETE CASCADE |
| `endpoint` | `varchar(100)` | route path |
| `status` | `varchar(20)` | `success` / `error` |
| `bytes` | `integer` | response size |
| `duration_ms` | `integer` | response time |
| Index | `(api_key_id, created_at)` | for 30-day usage queries |

### `magic_tokens`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `email` | `string` | indexed |
| `token` | `string` | UNIQUE, random |
| `used` | `boolean` | one-time use |
| `expires_at` | `timestamp` | TTL |

---

## Auth

### API Key Flow
1. Key format: `sk_` + 64 hex chars
2. On auth: extract first 8 chars (`key_prefix`), query `api_keys` by prefix
3. Compare full key against `key_hash` using `bcrypt.compare`
4. Sets `req.apiKey` (key record), `req.tier` (user tier), `req.isAdmin` (email match)

### Session Token Flow
1. Created via `POST /v1/session` with a valid API key
2. Random 128-char token stored in `sessions` table
3. Used as `x-session-token` header (preferred in dashboard, avoids exposing raw key)
4. Can switch which API key a session uses via `POST /v1/session/key`

---

## Tier Model

| Tier | Monthly Limit | Rate Limit | Features |
|------|---------------|------------|----------|
| Free | 10 | 5 req/min | Basic capture |
| Starter | 500 | 60 req/min | Higher limits |
| Pro | 2,500 | 250 req/min | + Comparison, AI describe |
| Business | 15,000 | 1,000 req/min | + Higher limits |

Tier is stored per user (not per key). Comparison (`/v1/compare`) and describe (`/v1/describe`) are gated to Pro and Business.

---

## Job Queue (BullMQ)

- **Queue**: `screenshots` in Redis
- **Worker**: runs in separate process (`src/workers/renderer.js`), concurrency 5
- **Retries**: 3 attempts, 2s exponential backoff
- **Flow**: User POST → job enqueued → worker picks up → Playwright captures → storage saved → DB updated

---

## Screenshot Rendering

### Options
| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `width` | integer | 1280 | viewport width |
| `height` | integer | 720 | viewport height |
| `mobile` | boolean | false | enables mobile emulation |
| `format` | string | `png` | `png` / `jpeg` / `webp` |
| `fullPage` | boolean | false | capture full scrollable height |
| `quality` | integer | — | JPEG/WebP quality 1-100 |
| `acceptCookies` | mixed | — | `true` (auto) or CSS selector string |
| `waitUntil` | string | `load` | `load` / `networkidle` |
| `delay` | integer | — | ms to wait after page load |
| `selector` | string | — | clip to element |
| `darkMode` | boolean | false | prefers-color-scheme: dark |

### Cookie Consent
Detects and dismisses cookie banners across 50+ known selectors, SourcePoint, TCF2.0, and text-based search in multiple languages (including Norwegian).

---

## Storage

Two backends, selected by config:

| Backend | Config | File Path |
|---------|--------|-----------|
| Local disk | (default) | `./screenshots/{id}.{format}` |
| S3-compatible | `STORAGE_ENDPOINT` + keys | `{bucket}/{id}.{format}` |

---

## Caching

- Redis cache with 1-hour TTL
- Cache key = SHA-256 of URL + options
- Only for synchronous `POST /screenshot`
- Bypassed when `fullPage=true` or `mobile=true`

---

## Cleanup

- Interval: every 15 minutes
- Deletes screenshots older than `SCREENSHOT_RETENTION_HOURS` (default 24)
- Baselines (`is_baseline = true`) are exempt
- Storage files deleted before DB rows

---

## Frontend

### Architecture
Single-page application in `public/index.html` (no framework, vanilla JS):

```
index.html
├── Auth section (signup / login / magic link)
└── Dashboard
    ├── Account tab (profile, usage, keys, pricing)
    ├── Try It tab
    │   ├── URL capture form (resolution presets, format, options)
    │   ├── HTML render form
    │   ├── Screenshot history (paginated, load more)
    │   └── Preview modal (image, diff, baseline, side-by-side)
    └── Admin tab (user table, edit/create/delete)
```

### i18n
- `LANG` object with `en` and `nb` (~90 keys each)
- `t(key)` → current language → English → key fallback
- `applyLanguage()` updates all `[data-i18n]` elements
- Date formatting: `toLocaleDateString(locale)`
- Currency: `Intl.NumberFormat` with locale

### Theme
- Detects `prefers-color-scheme`, stored in `localStorage`
- CSS custom properties with `[data-theme="dark"]`

---

## Configuration (.env)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | PostgreSQL connection |
| `REDIS_URL` | — | Redis connection |
| `STRIPE_SECRET_KEY` | — | Stripe API key |
| `STRIPE_STARTER_PRICE_ID` | — | Stripe price for Starter tier |
| `STRIPE_PRO_PRICE_ID` | — | Stripe price for Pro tier |
| `STRIPE_BUSINESS_PRICE_ID` | — | Stripe price for Business tier |
| `STORAGE_ENDPOINT` | — | S3 endpoint (optional, local disk otherwise) |
| `STORAGE_REGION` | — | S3 region |
| `STORAGE_BUCKET` | — | S3 bucket name |
| `STORAGE_ACCESS_KEY` | — | S3 access key |
| `STORAGE_SECRET_KEY` | — | S3 secret key |
| `SMTP_*` | — | Email config (fallback if no Resend) |
| `RESEND_API_KEY` | — | Resend email service |
| `GEMINI_API_KEY` | — | Google Gemini for describe |
| `ADMIN_EMAIL` | — | Email flagged as admin |
| `SCREENSHOT_RETENTION_HOURS` | `24` | Auto-delete after N hours |
| `PORT` | `3000` | HTTP port |
| `BASE_URL` | `http://localhost:3000` | Public-facing URL |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| bcrypt for API keys | Full keys unrecoverable from DB dump; only prefix stored in plaintext |
| Session tokens for dashboard | Avoids exposing raw API key in localStorage/network |
| BullMQ for async captures | Long-running Playwright tasks don't block the API |
| Tier gating on compare/describe | Comparison is compute-heavy; AI describe costs money |
| ON DELETE SET NULL for baseline_id | Deleting a baseline keeps comparison records intact |
| Raw body parser for Stripe webhook | Signature verification requires unmodified body |
| ESM modules | Modern Node.js standard; aligns with ecosystem |
| 15-min cleanup interval | Frequent enough to free space; infrequent enough to avoid DB load |

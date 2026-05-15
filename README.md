# Screenshot API

![CI](https://github.com/TrueCapslock/screenshot-api/actions/workflows/ci.yml/badge.svg)

A REST API that takes screenshots of any URL or renders HTML to images using headless Chromium. Built with Node.js + Playwright.

## Features

- **URL screenshots** — capture any web page as PNG, JPEG, or WebP
- **HTML rendering** — convert HTML/CSS to an image
- **Synchronous & async** — choose between blocking or queued processing with webhook callbacks
- **Full-page capture** — scrollable pages, specific elements via CSS selector
- **Ad blocking** — strip ads and trackers from captures
- **Dark mode, mobile viewport, custom delays** — full control over the render
- **Caching** — optional Redis-backed cache for repeat URLs
- **S3 storage** — save screenshots to S3-compatible storage (or local disk)
- **Billing** — Stripe subscription tiers with usage tracking and rate limiting
- **Dashboard** — web UI for signup, API key management, live testing, and usage overview
- **Admin panel** — user management with inline editing, usage stats, and user deletion
- **Cookie consent handling** — auto-accept cookie banners via built-in selectors or custom CSS selector
- **Screenshot retention** — configurable automatic cleanup of old screenshots (default 1 hour)
- **Dark/light theme** — auto-detects system preference, persisted in localStorage
- **NO/EN language toggle** — full Norwegian Bokmål translation

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js 22 (ESM) |
| Framework | Express |
| Browser | Playwright (Chromium headless) |
| Database | PostgreSQL via Knex |
| Queue | BullMQ + Redis |
| Billing | Stripe |
| Validation | Zod |
| Storage | Local disk or S3-compatible (MinIO, B2, AWS S3) |
| Auth | API keys (bcrypt hashed) |
| Docs | OpenAPI 3.1 + Swagger UI |
| Tests | Vitest + Supertest |

## Quick Start

### Prerequisites

- Node.js 22
- PostgreSQL 17+
- Redis 7+
- Docker (optional — for running Postgres/Redis locally)

### 1. Clone and install

```bash
git clone <repo-url> screenshot-api
cd screenshot-api
cp .env.example .env
npm install
npx playwright install chromium
```

### 2. Start services

```bash
# Using Docker (recommended for local dev)
docker compose up -d postgres redis

# Or run PostgreSQL + Redis natively
```

### 3. Run migrations

```bash
npm run migrate
```

### 4. Start the server

```bash
npm run dev
```

Open http://localhost:3000/docs for the dashboard and http://localhost:3000/docs/api for Swagger.

## API Reference

All API endpoints require an API key passed via the `x-api-key` header, except `/health` and `/v1/signup`.

### Health Check

#### `GET /health`

Returns the service status with connectivity checks for PostgreSQL and Redis. Returns `200 OK` when all services are healthy, `503 Service Unavailable` when degraded.

Response `200`:
```json
{
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": { "db": true, "redis": true }
}
```

### Authentication

```
x-api-key: sk_<your-64-char-hex-key>
```

Keys are created via the dashboard or the `/v1/signup` endpoint. The full key is shown **once** at creation — store it securely.

### Endpoints

#### `POST /v1/signup`

Create an account and receive your first API key.

```json
{ "email": "user@example.com", "name": "Optional Name" }
```

Response `201`:
```json
{
  "user": { "id": "uuid", "email": "...", "tier": "free" },
  "api_key": "sk_<full-key>",
  "message": "Save your API key — it will not be shown again"
}
```

#### `POST /v1/screenshot`

Take a synchronous screenshot. Returns the image binary directly.

```json
{
  "url": "https://example.com",
  "format": "png",
  "fullPage": true,
  "width": 1280,
  "height": 720,
  "mobile": false,
  "darkMode": false,
  "delay": 0,
  "blockAds": false,
  "cache": false
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | — | **Required.** URL to capture |
| `format` | `png` / `jpeg` / `webp` | `png` | Output image format |
| `quality` | integer 1–100 | — | JPEG/WebP compression quality |
| `width` | integer | `1280` | Viewport width in pixels |
| `height` | integer | `720` | Viewport height in pixels |
| `fullPage` | boolean | `true` | Capture entire scrollable page |
| `selector` | string | — | CSS selector to capture a specific element |
| `delay` | integer (ms) | `0` | Wait before capturing |
| `timeout` | integer (s) | `30` | Page load timeout |
| `waitUntil` | `load` / `domcontentloaded` / `networkidle` | `networkidle` | When to consider page loaded |
| `waitForSelector` | string | — | Wait for a CSS selector before capture |
| `mobile` | boolean | `false` | Emulate iPhone viewport (390×844) |
| `darkMode` | boolean | `false` | Emulate prefers-color-scheme: dark |
| `blockAds` | boolean | `false` | Block ad/tracker domains |
| `scrollToBottom` | boolean | `false` | Scroll to bottom before capture |
| `cache` | boolean | `false` | Enable Redis caching (1 hour TTL) |

Response `200` — image binary with `Content-Type: image/png` (or `image/jpeg`, `image/webp`).

Response headers:

| Header | Description |
|--------|-------------|
| `X-Screenshot-Id` | Screenshot record UUID |
| `X-Duration-Ms` | Render time in milliseconds |
| `X-Cache` | `HIT` or `MISS` (when `cache: true`) |

#### `POST /v1/html`

Render raw HTML to an image.

```json
{
  "html": "<h1 style='color:red'>Hello</h1>",
  "format": "png",
  "fullPage": false,
  "width": 800,
  "height": 600
}
```

#### `POST /v1/screenshot/async`

Queue an asynchronous screenshot. The server responds immediately with a `job_id`. Poll `GET /v1/screenshot/:id` to retrieve the result, or provide a `webhookUrl` to be notified when complete.

```json
{
  "url": "https://example.com",
  "webhookUrl": "https://myapp.com/webhook",
  "format": "png"
}
```

Response `202`:
```json
{
  "job_id": "uuid",
  "status": "pending",
  "url": "http://localhost:3000/v1/screenshot/<uuid>"
}
```

#### `GET /v1/screenshot/:id`

Retrieve the result of an async screenshot. Returns the image if complete, or a status object if still processing.

#### `GET /v1/account`

Get your account info, usage, and API keys.

#### `GET /v1/keys` / `POST /v1/keys` / `DELETE /v1/keys/:id`

List, create, and revoke API keys.

#### `POST /v1/stripe/checkout`

Create a Stripe Checkout Session for upgrading. Requires `priceId` in the request body.

```json
{ "priceId": "price_xxx" }
```

#### `POST /v1/stripe/portal`

Create a Stripe Customer Portal session for managing subscriptions.

#### `POST /v1/stripe/webhook`

Stripe webhook handler (uses raw body parser). Endpoint for Stripe to send `checkout.session.completed`, `customer.subscription.*` events.

#### Admin Endpoints

All admin endpoints require an API key whose email matches `ADMIN_EMAIL`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/admin/users` | List all users with usage stats |
| `GET` | `/v1/admin/users/:id` | Get user details and API keys |
| `PATCH` | `/v1/admin/users/:id` | Update user tier or name |
| `DELETE` | `/v1/admin/users/:id` | Delete a user and all their data |

#### `GET /v1/account/screenshots`

List the last 50 screenshots for the authenticated user with metadata (URL, format, size, timestamps).

### Rate Limiting

| Tier | Monthly Limit | Rate Limit |
|------|--------------|------------|
| Free | 25 screenshots | 10 req/min |
| Starter | 1,000 | 60 req/min |
| Pro | 5,000 | 250 req/min |
| Business | 25,000 | 1,000 req/min |

Rate limit headers are returned with every response:

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 8
X-RateLimit-Tier: free
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection string |
| `STRIPE_SECRET_KEY` | — | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret |
| `STRIPE_STARTER_PRICE_ID` | — | Stripe price ID for Starter tier |
| `STRIPE_PRO_PRICE_ID` | — | Stripe price ID for Pro tier |
| `STRIPE_BUSINESS_PRICE_ID` | — | Stripe price ID for Business tier |
| `STORAGE_ENDPOINT` | — | S3-compatible endpoint (e.g., MinIO, B2). Leave empty for local storage |
| `STORAGE_REGION` | `us-east-1` | S3 region |
| `STORAGE_BUCKET` | — | S3 bucket name |
| `STORAGE_ACCESS_KEY` | — | S3 access key |
| `STORAGE_SECRET_KEY` | — | S3 secret key |
| `BASE_URL` | `http://localhost:3000` | Public-facing URL for links and redirects |
| `ADMIN_EMAIL` | — | Email address granted admin privileges |
| `SCREENSHOT_RETENTION_HOURS` | `1` | Hours to retain screenshots before auto-cleanup |

### Cookie Consent

Pass `acceptCookies: true` to auto-accept common cookie banners, or `acceptCookies: "#my-selector"` for a custom CSS selector. The engine uses a 3-layer fallback: main page selectors, iframe selectors (for CMP dialogs like Sourcepoint), and then in-page JavaScript evaluation (TCF API / `_sp_` API / text content match).

## Deployment (Coolify)

1. Push this repository to GitHub/GitLab.
2. In Coolify, create a **Project** and add these resources:
    - **PostgreSQL** service (Coolify's built-in database)
    - **Redis** service (Coolify's built-in database)
    - **App** service — build from `docker/Dockerfile`, set start command to `node src/index.js`
    - **Worker** service — same image, start command `node src/workers/renderer.js`
3. Set environment variables matching `.env.example` (omitting the ones Coolify auto-provides for Postgres/Redis).
4. Make sure `SCREENSHOT_RETENTION_HOURS` is set to control how long screenshots are kept (default: 1 hour).
5. Set `ADMIN_EMAIL` to grant yourself admin access to the dashboard.
6. Deploy.

> The Dockerfile installs Chromium + system dependencies automatically.

## Testing Stripe Billing Locally

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli):
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe

   # Linux
   curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg
   echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee -a /etc/apt/sources.list.d/stripe.list
   sudo apt update && sudo apt install stripe
   ```
2. Log in and forward webhook events to your local server:
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/v1/stripe/webhook
   ```
3. Copy the webhook signing secret printed by the CLI into your `.env` as `STRIPE_WEBHOOK_SECRET`.
4. Open the dashboard at `http://localhost:3000/docs`, subscribe to a plan, and complete the checkout in Stripe's test mode (use card `4242 4242 4242 4242`).
5. Check `http://localhost:3000/docs/api` to verify the subscription tier updated via the OpenAPI docs.

> Stripe price IDs (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_BUSINESS_PRICE_ID`) must be set in `.env` — create them in the [Stripe Dashboard](https://dashboard.stripe.com/test/products).

## Management Script

Use `bash ctrl.sh` for an interactive menu to start/stop all services, run migrations, view status, and run tests.

```bash
bash ctrl.sh       # Interactive menu (option 12 runs tests)
bash ctrl.sh menu  # Same
bash ctrl.sh start # Start all
bash ctrl.sh stop  # Stop all
bash ctrl.sh status # Show status
```

## Screenshot Retention

Old screenshots are automatically cleaned up every 15 minutes. The retention window is controlled by `SCREENSHOT_RETENTION_HOURS` (default: 1 hour). When a screenshot exceeds the retention window, its storage file and database record are permanently deleted.

## Architecture

```
                  ┌─────────────┐
                  │   Client    │
                  └──────┬──────┘
                         │ x-api-key
                  ┌──────▼──────┐
                  │  Express    │
                  │   Server    │
                  └──┬──────┬───┘
                     │      │
              ┌──────▼┐  ┌──▼──────┐
              │  PG   │  │  Redis  │
              │(users,│  │(queue,  │
              │ keys, │  │  cache, │
              │ usage)│  │  rate   │
              └───────┘  │ limits) │
                         └──┬──────┘
                            │
                    ┌───────▼───────┐
                    │  BullMQ       │
                    │  Worker       │
                    │ (Playwright)  │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │   Storage     │
                    │ (Local / S3)  │
                    └───────────────┘
```

## Project Structure

```
src/
├── app.js                 # Express setup + routes
├── config.js              # Environment config
├── index.js               # Entry point (migrates + starts)
├── db/
│   ├── knex.js            # PostgreSQL client
│   └── migrations/        # Schema migrations
├── middleware/
│   ├── auth.js            # API key lookup + verification
│   ├── admin.js           # Admin access guard
│   ├── rateLimit.js       # Redis sliding window
│   ├── usage.js           # Request logging (screenshot/HTML only)
│   └── errorHandler.js    # Centralized error handling
├── routes/
│   ├── auth.js            # POST /v1/signup
│   ├── keys.js            # CRUD /v1/keys
│   ├── screenshot.js      # POST /v1/screenshot, /v1/html
│   ├── async.js           # POST /v1/screenshot/async
│   ├── account.js         # GET /v1/account
│   ├── admin.js           # Admin user management
│   └── stripe.js          # Stripe billing endpoints
├── services/
│   ├── renderer.js        # Playwright screenshot engine
│   ├── billing.js         # Stripe integration
│   ├── storage.js         # Local / S3 file storage
│   └── cache.js           # Redis caching
├── jobs/
│   └── screenshot.js      # BullMQ queue definition
├── workers/
│   └── renderer.js        # BullMQ consumer (separate process)
├── cleanup.js             # Periodic screenshot retention cleanup
├── config.js              # Environment config
└── db/
    ├── knex.js            # PostgreSQL client
    └── migrations/        # Schema migrations
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with `--watch` (auto-restart on changes) |
| `npm start` | Start in production mode |
| `npm run migrate` | Run pending database migrations |
| `npm run seed` | Run database seed (stubs) |
| `npm test` | Run test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

## Testing

The project uses [Vitest](https://vitest.dev/) for unit and integration tests, with [Supertest](https://github.com/ladjs/supertest) for HTTP endpoint testing.

```bash
npm test              # Run once
npm run test:watch    # Watch mode
```

### Test Structure

| File | Type | Coverage |
|------|------|----------|
| `tests/validation.test.js` | Unit | Zod schemas — field bounds, enums, optionals, error cases |
| `tests/middleware.test.js` | Unit | `errorHandler` (status codes, messages), `admin` (auth guard) |
| `tests/api.test.js` | Integration | Health check, auth rejection, redirects, 404 handling |

Tests requiring a database (full endpoint workflows) assume PostgreSQL and Redis are available — start them via `docker compose up -d postgres redis` before running. Use `DATABASE_URL` and `REDIS_URL` env vars to point to a test instance.

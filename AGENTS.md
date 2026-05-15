# AGENTS.md — Screenshot API

## Project
Screenshot capture & comparison API with dashboard. Express.js + PostgreSQL + Redis + Playwright.

## Commands
| Command | Action |
|---------|--------|
| `npm test` | Run all tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with eslint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format with prettier |
| `npm run format:check` | Check formatting |
| `npm run migrate` | Run DB migrations |
| `npm run seed` | Seed DB |
| `npm run dev` | Start dev server with --watch |
| `npm start` | Start production server |
| `bash dev-menu.sh` | Main dev menu (keyboard-driven) |

## Module System
ESM (`"type": "module"`) — use `import`/`export`, not `require`.

## Testing
- Vitest with globals (`describe`, `it`, `expect` available without import)
- Setup file: `tests/setup.js`
- Test timeout: 15s
- Supertest for HTTP tests

## Linting & Formatting
- `eslint.config.js` — ESLint flat config
- `.prettierrc` — Prettier config

## Project Structure
```
src/
  app.js              Express app setup
  index.js            Server entry point
  config.js           Config (tiers, version)
  cleanup.js          Cleanup job
  db/
    migrate.js        Migration runner
    seed.js           Seed data
    migrations/       DB migrations
    connection.js     DB connection
  routes/             Route handlers
  middleware/         Express middleware (auth, admin, rateLimit, errorHandler, validate)
  services/           Business logic (renderer, email)
  jobs/               Background job processing
  workers/            Worker processes
  utils/              Utility functions
tests/                Test files
public/               Frontend (HTML/CSS/JS dashboard)
dev-menu.sh           Development menu (main entry for dev tasks)
release-note.md       Versioned changelog + commit message source
```

## Release Workflow
1. Add entries under `## Unreleased` in `release-note.md`
2. Bump version via dev-menu (patch/minor/major) — renames `## Unreleased` → `## vX.Y.Z` in release-note.md + updates package.json
3. Stage & Commit via dev-menu — commits with only the current version's release notes; creates new blank `## Unreleased`; strips old version entries
4. Push via dev-menu

## Dev Menu
Always use `bash dev-menu.sh` for development tasks (start/stop, Docker, migrate, test, bump, commit, push, build). Arrow keys to navigate, Enter to select.

## Docker
- Compose project name: `screenshot-api`
- Config: `docker-compose.yaml` + `docker-compose.override.yaml` (port mappings for local dev)
- Production (Coolify) uses only `docker-compose.yaml` (no port mappings)

## Key Conventions
- Auth supports `x-api-key` and `x-session-token` headers
- Session-based auth preferred (stored in localStorage, created on page load)
- All API routes mounted under `/v1`
- Stripe webhook at `/v1/stripe/webhook` — no auth, uses `express.raw()` body parser
- Version from `package.json` exposed via `/health` and `X-API-Version` header
- Screenshot comparison tier-gated (Pro/Business only)
- Gemini AI uses model `gemini-2.0-flash` with API version `v1beta`

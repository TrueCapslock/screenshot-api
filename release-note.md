## v1.0.17 (2026-05-15)
- Swagger: use relative server URL (`/`) instead of dynamic protocol detection so Try It requests work over both HTTP and HTTPS without mixed-content errors (`src/app.js`)
- Sentry: stopped forwarding `console.log`/info-level log entries; only `console.warn` and `console.error` are sent as Sentry logs (`src/instrument.js`)

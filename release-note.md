## Unreleased

- Docker: add named volume for screenshots directory to persist across container redeploys
- Docker: move port mappings to docker-compose.override.yaml to prevent Coolify deployment port conflict
- Menu: fix _dmenu_lines global variable bleed between submenus
- Menu: use release-note.md for git commit message (extracts Unreleased section)
- Menu: git push uses `-u origin HEAD` to auto-set upstream
- Menu: remove "Press any key" prompt after returning from docker submenu
- Menu: add inner input loop for smooth no-flicker arrow navigation in all submenus
- Menu: fix line count values for all menus (prevents menu drift on arrow keys)
- Renderer: set viewport before page navigation so CSS media queries use correct screen size

## v0.1.0 (2026-05-14)

Initial release: keyboard-driven dev menu and screenshot comparison features.

- Add keyboard-driven dev-menu.sh as single entry point for project control
  - Arrow key navigation, keyboard shortcuts, live Docker/app/worker status
  - Submenus: Development (start/stop, migrations, status), Deploy (tests, version bump, Docker build/push, git)
  - No-flicker in-place redraw on arrow keys using ANSI escape sequences
- Add screenshot comparison tab with baseline image in normal document flow
  - Slider overlay for A/B comparison, diff tab in view dialog
  - initSlider handles already-cached images via img.complete check
  - Resolution selector: Desktop (1280x720), Tablet (768x1024), Mobile (390x844), Custom
- Add AI describe endpoint (GET /v1/screenshot/:id/describe)
  - Sends baseline + screenshot to Google Gemini 2.0 Flash
  - 5 retries with exponential backoff (2s/4s/6s/8s/8s)
  - Returns bullet-point description of visual differences
- Fix baseline management: only one baseline per URL/viewport
  - unmarkExistingBaselines uses WHERE IN subquery instead of invalid JOIN+UPDATE
  - Cleanup excludes baselines from auto-deletion
- Fix Stripe webhook: removed global auth/rate-limit from compare.js
  - Webhook route regex handles trailing slashes (/stripe/webhook/?$)
  - express.raw() body parser applied before express.json() for signature verification
- Fix compare endpoint FK collision: explicit .select('screenshots.id', ...)
- Docker: add port mappings for local dev, Playwright install fix in Dockerfile
- Version from package.json at runtime, exposed via /health and X-API-Version header
- Local Docker URLs in .env (replaced remote cloud URLs)
- Menu restructured with Development/Deploy/Docker submenus
- 58 passing tests across 6 test files
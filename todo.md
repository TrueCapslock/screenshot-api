# Todos

## Bugs
- [ ] Fix `adminRouter` — global `router.use(auth, admin)` returns 403 instead of 404 for unmatched `/v1/*` routes. Routes mounted after it (compare, describe, session) are unreachable for non-admin users when accessed under `/v1/*` without matching an earlier route.
- [x] Run lint (`npm run lint`) and fix any issues
- [x] Run format check (`npm run format:check`) and fix any issues

## Tests
- [x] Add edge-case test coverage (invalid session tokens, expired sessions, key switching via sessions)
- [x] Add integration tests for screenshot capture and comparison flows
- [x] Add tests for rate limiting behavior

## Features
- [ ] Build and push Docker image for new version
- [ ] Deploy to production (Coolify)
- [ ] Dashboard: add admin panel for managing users/keys

## Release
- [ ] Bump version, commit, and push when ready for release

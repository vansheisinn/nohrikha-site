# Nohrikha aggregate counter

Own Cloudflare Worker + D1 service; the website stays on GitHub Pages.
Public aggregate statistics, no visitor IDs, IP storage or request logging.

- Worker: `nohrikha-counter.vansheisinn.workers.dev`.
- D1 binding: `DB`, database `nohrikha-counter` (ID in `wrangler.jsonc`).
- Tables initialize automatically from `schema.ts`; existing counts are never reset.
- Runtime secret: `COUNTER_SIGNING_KEY`, random and at least 32 bytes.
- Optional `MAX_DAILY_VIEWS`: 5000 by default.
- Dashboard editor: paste the complete `worker.bundle.js`, then Deploy.
- For dashboard deployment, configure the D1 binding, secret and observability
  settings in the dashboard; Wrangler settings are not applied by pasting JS.
- Development: `npm ci`, `npm run check`, `npm test`, `npm run bundle`.
- Local tests use workerd with real local D1. No cloud credentials are needed.
- Production code has no third-party runtime dependencies.

`GET /health` checks the process; `GET /stats` reads public aggregates.
HMAC challenges, a bounded in-memory replay cache, request budgets and a global
atomic daily cap provide best-effort protection; distributed inflation remains
possible. No public reset or delete route. Remain on Workers Free, without a
payment card or paid upgrades. Full instructions: [COUNTER_SETUP.md](../COUNTER_SETUP.md).

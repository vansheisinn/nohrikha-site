# Nohrikha aggregate counter

Small, dependency-free Deno + Deno KV service. The website stays on GitHub
Pages. Deployment is not enabled by adding these files.

- App directory: `counter`.
- Start: `deno task start`.
- Assign a Deno KV database to the production app.
- Set the server secret `COUNTER_SIGNING_KEY` to a random value of at least 32
  bytes.
- Optional `MAX_DAILY_VIEWS`: 5000 by default.
- Do not set `COUNTER_KV_PATH` on Deploy; that setting is for local testing
  only.
- Check: `deno task check && deno task test`.

`GET /health` checks the running process; `GET /stats` reads public aggregate
data. Collection is limited to the site's exact origin. A signed short-lived
challenge, bounded in-memory replay cache and atomic daily cap provide
best-effort abuse protection. They do not prevent distributed replay or
deliberate inflation. No request logging, third-party dependencies, persistent
visitor IDs or IP storage.

Before deployment, confirm that the current Free plan and KV are usable without
adding a card or enabling paid billing. Full owner instructions and limitations:
[COUNTER_SETUP.md](../COUNTER_SETUP.md).

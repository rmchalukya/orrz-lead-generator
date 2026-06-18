# Deployment — Railway (worker + Postgres) + Vercel (app)

Architecture in production:

```
Vercel (Next.js app + API + webhooks)  ──┐
                                          ├──▶  Railway Postgres  ◀──  Railway worker
Resend webhook ──▶ /api/webhooks/email ──┘        (+ pg-boss queue)     (pipeline)
```

- **App** (dashboard, API, channel webhooks) → **Vercel**.
- **Worker** (discover → analyze → score → personalize → send) → **Railway** (long-running; Vercel can't host it).
- **Postgres** (data + pg-boss queue) → **Railway Postgres plugin**.

Config files already in the repo: [`railway.json`](railway.json) (worker), [`vercel.json`](vercel.json) (app).

---

## 1. Railway — Postgres + worker

1. Create a Railway project → **+ New** → **Database → PostgreSQL**.
2. **+ New → GitHub Repo** → select this repo. Railway reads `railway.json`:
   - build: `npx prisma generate`
   - start: `npm run start:worker` → runs `prisma migrate deploy` (creates all tables) **then** starts the worker.
3. In the worker service **Variables**, set:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway reference — internal, fast) |
   | `GOOGLE_PLACES_API_KEY` | your key |
   | `ANTHROPIC_API_KEY` | your key |
   | `RESEND_API_KEY` | your key |
   | `RESEND_FROM` | `Ajay Aggarwal <ajay@bolbahi.app>` |
   | `SENDER_NAME` / `SENDER_COMPANY` / `SENDER_PHONE` / `SENDER_WEBSITE` | your signature values |
   | `SENDER_NAME_POOL` | optional |
4. Deploy. The worker log should show migrations applied + `pipeline workers registered`.

> The worker is what discovers leads, calls the AI, and sends email — so the API keys live here.

---

## 2. Vercel — the app

1. **Add New → Project** → import this repo. Framework auto-detects **Next.js**; `vercel.json` sets the build to `prisma generate && next build`.
2. **Environment Variables** (Production):
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Railway Postgres **public** connection string + `?connection_limit=5` (see note below) |
   | `RESEND_WEBHOOK_SECRET` | from Resend (for webhook verification) |
   | `APP_BASE_URL` | your Vercel URL, e.g. `https://your-app.vercel.app` |
3. Deploy.

> ⚠️ **Connection pooling.** Vercel runs serverless functions that each open DB connections; Railway Postgres has a low connection cap. Append `?connection_limit=5` (and consider `&pool_timeout=20`) to the app's `DATABASE_URL`, or front Postgres with a pooler. The worker uses the internal `${{Postgres.DATABASE_URL}}` and is a single process, so it doesn't need this.

> Use Railway's **public** TCP proxy URL for the Vercel app (it's outside Railway's private network); use the `${{Postgres.DATABASE_URL}}` reference for the worker (same project network).

---

## 3. Resend — webhook + domain

1. **Domains**: `bolbahi.app` is verified (sending works). Verify any additional sending domain you want.
2. **Webhooks → Add Endpoint**: `https://<your-vercel-app>/api/webhooks/email`.
   Subscribe to `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`.
   Put the signing secret in Vercel's `RESEND_WEBHOOK_SECRET`.

---

## Deploy order (first time)

1. **Railway first** — Postgres + worker. The worker's `prisma migrate deploy` creates the schema, and pg-boss creates its queue tables on start.
2. **Vercel second** — point `DATABASE_URL` at the same Railway Postgres.
3. **Resend webhook** — point at the live Vercel URL.

## After deploy — smoke test

- Open the Vercel URL → create a campaign → **Run**. Within ~30s the worker logs should show discovery + analysis, and the campaign page should fill with scored leads.
- `GET https://<app>/api/health` → `{ ok: true }`.

## Notes & caveats

- **pg-boss on Vercel:** the app only *enqueues* (in the `runCampaign` server action). `getBoss()` connects + ensures queues per warm instance — fine for low/moderate volume. At high volume, move enqueueing to a small Railway HTTP endpoint instead of the serverless app.
- **Migrations** run only from the Railway worker (`start:worker`). Don't also run them from Vercel — avoids races. New migration → redeploy the worker.
- **Secrets:** rotate any keys that were shared in plaintext during development before going live.
- **Cold email compliance:** keep the unsubscribe line, honor "stop" replies, and warm up the sending domain gradually.

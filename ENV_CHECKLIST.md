# Production environment variables — Railway (worker) vs Vercel (app)

Derived from actual `process.env.*` usage in the code. The **worker** does all the
external work (discover, analyze, personalize, send), so nearly all keys live on
Railway. The **app** only reads the DB and enqueues jobs.

## Railway — worker service

| Variable | Required | Value / notes |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Use the Railway reference `${{Postgres.DATABASE_URL}}` (internal network, fast). Used by Prisma + pg-boss. |
| `GOOGLE_PLACES_API_KEY` | ✅ | Lead discovery + PageSpeed analysis. |
| `ANTHROPIC_API_KEY` | ✅ | Claude Haiku personalization. |
| `RESEND_API_KEY` | ✅ | Sending email. |
| `RESEND_FROM` | ✅ | `Ajay Aggarwal <ajay@bolbahi.app>` (verified domain). |
| `SENDER_NAME` | ✅ | Signature name (fallback if no pool). |
| `SENDER_COMPANY` | ✅ | Signature company. |
| `SENDER_PHONE` | ✅ | `+91 98103 77928` |
| `SENDER_WEBSITE` | ✅ | One or more comma-separated URLs (rendered as links). |
| `SENDER_NAME_POOL` | ⬜ optional | Comma-separated real teammate names to rotate sender per lead. Leave empty to use `SENDER_NAME`. |
| `PGBOSS_DATABASE_URL` | ⬜ optional | Only if the queue should use a different DB than `DATABASE_URL`. |

> Railway sets `NODE_ENV=production` automatically — don't set it yourself.

## Vercel — app

| Variable | Required | Value / notes |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Railway Postgres **public** connection string + `?connection_limit=5` (serverless connection cap). Used for reads + enqueue. |
| `RESEND_WEBHOOK_SECRET` | ⬜ pending | Not read by code yet (webhook signature verification is a TODO). Set it now so it's ready when verification ships. |
| `APP_BASE_URL` | ⬜ optional | `https://<your-app>.vercel.app`. Not referenced in code yet; set if/when emails link back to the app. |

> The app does **not** need the Google / Anthropic / Resend sending keys or the
> `SENDER_*` vars — it never discovers, personalizes, or sends. Those run only on
> the worker. Keep them off Vercel to shrink the secret blast radius.

## Local-only — never set in production

| Variable | Why |
|---|---|
| `TEST_EMAIL` | Only used by `scripts/run-demo.mts`. |
| `SEND` | Only used by `scripts/run-demo.mts` to gate the live send. |

## Quick paste lists

**Railway worker** (9 required + 2 optional):
```
DATABASE_URL  GOOGLE_PLACES_API_KEY  ANTHROPIC_API_KEY  RESEND_API_KEY
RESEND_FROM  SENDER_NAME  SENDER_COMPANY  SENDER_PHONE  SENDER_WEBSITE
[SENDER_NAME_POOL]  [PGBOSS_DATABASE_URL]
```

**Vercel app** (1 required + 2 optional):
```
DATABASE_URL  [RESEND_WEBHOOK_SECRET]  [APP_BASE_URL]
```

## Before flipping live
- [ ] Rotate every key shared in plaintext during development; set the fresh ones here.
- [ ] Confirm `DATABASE_URL` on Vercel is the **public** URL with `?connection_limit=5`; on Railway it's the `${{Postgres.DATABASE_URL}}` reference.
- [ ] Deploy Railway first (runs `prisma migrate deploy` + pg-boss schema), then Vercel.
- [ ] Point the Resend webhook at `https://<app>/api/webhooks/email`.

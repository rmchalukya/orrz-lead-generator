# Lead Generator

Generic lead-generation & automated-outreach platform. The engine is business-case-agnostic
(**Playbooks**) and channel-pluggable (**Channels** — email now, WhatsApp/SMS/LinkedIn later).

- Architecture & design rationale: [PLAN.md](PLAN.md)
- Original business requirements: [requirements.md](requirements.md)

## Stack
- **Next.js** (App Router) — dashboard + API + channel webhooks
- **Worker** — drains the job queue and runs the pipeline
- **Postgres** (Neon/Supabase free) via **Prisma**
- **pg-boss** — Postgres-backed queue (no Redis)
- **Claude Haiku 4.5** — AI personalization · **Resend** — email · **Google Places** — discovery

## Layout
```
app/                      Next.js routes (dashboard, /api, /api/webhooks/:channel)
worker/                   pg-boss consumer entry point
core/
  channels/               Channel interface + registry + EmailChannel
  sources/                LeadSource interface + registry + GooglePlacesSource
  analyzers/              Analyzer interface + registry + WebsiteAnalyzer
  playbooks/              Playbook interface + registry
  scoring.ts              declarative rule engine
  personalize.ts          Claude Haiku personalization
  pipeline.ts             the step pipeline (discover→…→sendTouch)
  db.ts / queue.ts        Prisma client / pg-boss
playbooks/website-sales.ts  the reference business case (config only)
prisma/schema.prisma
```

## Setup
```bash
npm install
cp .env.example .env          # fill DATABASE_URL + API keys
npm run prisma:generate
npm run prisma:migrate        # creates tables
npm run typecheck             # validate the scaffold

# two processes:
npm run dev                   # Next.js app on :3000
npm run worker                # background pipeline worker
```

## Run a campaign
```bash
# 1. create a campaign for the website-sales playbook
curl -XPOST localhost:3000/api/campaigns -H 'content-type: application/json' -d '{
  "playbookKey": "website-sales",
  "name": "Dentists Mumbai",
  "params": { "businessType": "Dentists", "city": "Mumbai", "state": "MH", "country": "India" }
}'

# 2. run it (enqueues discovery; the worker does the rest)
curl -XPOST localhost:3000/api/campaigns/<id>/run
```

## Extending
- **New business case** → add `playbooks/<name>.ts` and register it. Add a source/analyzer only if needed.
- **New channel** (e.g. WhatsApp) → implement `Channel` in `core/channels/<name>.ts`, register it,
  add templates, and set `channel: "whatsapp"` on a playbook touch. No engine/schema/UI changes.

See PLAN.md §2 for the abstractions and §7 for the phased build order.

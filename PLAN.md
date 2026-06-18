# Implementation Plan — Generic Lead Generation & Outreach Platform

> Companion to [requirements.md](requirements.md). The BRD describes one business case
> (website sales). This plan generalizes that into a **reusable engine** that can run lead
> generation for *any* business case, with **pluggable outreach channels** (email now,
> WhatsApp/SMS/LinkedIn later) and **pluggable discovery sources & analyzers**.

## 1. Design goals

1. **Business-case-agnostic.** The website-sales campaign is just one *Playbook*. A new
   vertical (e.g. "sell POS systems to restaurants", "sell SEO audits to clinics") is a new
   config + a few plugins, not a new app.
2. **Channel-pluggable.** Outreach is abstracted behind a `Channel` interface. Email (Resend)
   ships first; WhatsApp, SMS, LinkedIn drop in without touching the sequence engine.
3. **Source- & analyzer-pluggable.** Discovery and qualification are composable steps so a
   playbook picks which sources to pull from and which analyzers to run.
4. **Minimum cost.** Single Next.js app + one worker, Postgres-backed queue (pg-boss, no
   Redis), free-tier infra. See [requirements.md](requirements.md) cost model.

## 2. The three core abstractions

### 2.1 Playbook — the business case
A Playbook is config (+ optional code hooks) that fully describes one campaign type:

```ts
interface Playbook {
  key: string;                       // "website-sales", "pos-systems", ...
  discovery: {
    sources: SourceRef[];            // which LeadSource plugins, with params
    queryTemplates: string[];        // "{businessType} in {city}"
  };
  analyzers: AnalyzerRef[];          // which Analyzer plugins run per lead
  scoring: ScoringRule[];            // declarative rules over lead + analysis
  qualification: { include: Expr; priorityBands: Band[] };
  personalization: { promptKey: string; offer: OfferConfig };
  sequence: TouchDef[];              // channel-agnostic touch plan (see 2.2)
}
```

Playbooks live as data (DB rows + a registry of code hooks). The website business ships as
the **reference playbook** in `playbooks/website-sales/`.

### 2.2 Channel — pluggable outreach
Every outbound touch goes through a `Channel`. The sequence engine never imports Resend
directly — it resolves the channel by name.

```ts
interface Channel {
  key: "email" | "whatsapp" | "sms" | "linkedin";
  send(input: OutboundMessage): Promise<SendResult>;       // returns providerMessageId
  verifyWebhook(req): WebhookEvent[];                      // opens/clicks/replies/bounces
  capabilities: { supportsHtml: boolean; supportsOpenTracking: boolean; rateLimit: RateLimit };
}

interface TouchDef {
  day: number;                 // 0, 3, 7, 14, 21
  channel: Channel["key"];     // "email" today; "whatsapp" tomorrow
  templateKey: string;         // resolves to a channel-appropriate template
  stopOn: ("replied"|"bounced"|"unsubscribed")[];
}
```

- **Today:** `EmailChannel` (Resend) is the only registered channel.
- **Future WhatsApp:** implement `WhatsAppChannel` (Meta Cloud API / Twilio), register it,
  and add touches with `channel: "whatsapp"`. **No change to the sequence engine, schema,
  or dashboard.** The only WhatsApp-specific work is the channel impl + its templates +
  inbound webhook mapping.

### 2.3 Source & Analyzer — pluggable discovery and qualification
```ts
interface LeadSource {                 // Google Places now; directories/CSV/scrape later
  key: string;
  discover(query: DiscoveryQuery): AsyncIterable<RawLead>;
}
interface Analyzer {                   // WebsiteAnalyzer now; any signal later
  key: string;
  analyze(lead: Lead): Promise<AnalysisResult>;   // writes typed JSON into LeadInsights
}
```

The website-quality analyzer (PageSpeed + cheerio) is just `WebsiteAnalyzer`. A different
business case might register a `ReviewVolumeAnalyzer` or `TechStackAnalyzer` instead.

## 3. Architecture (unchanged, low-cost)

```
Next.js (Vercel)  ──enqueue──▶  Postgres + pg-boss  ◀──drain──  Worker (Render)
  dashboard / API                 (Neon free)                   step pipeline (§5)
  channel webhooks ──▶ /api/webhooks/:channel ──▶ EmailEvents / Replies / status updates
```

- **One Next.js app** = UI + API (Route Handlers). No separate Express service.
- **One worker** drains pg-boss jobs and runs the pipeline.
- **Postgres** via Prisma. **pg-boss** for queue (no Redis → one less paid service).

## 4. Data model (generalized from BRD §8)

Key change from the BRD: leads carry a **generic `attributes` JSON** plus typed columns,
and everything is scoped to a Playbook so the schema serves any business case.

| Table | Notes / generalization |
|---|---|
| `Playbook` | key, version, config JSON (§2.1). Campaigns reference one. |
| `Campaign` | `playbookKey`, geo/vertical params, status. |
| `Lead` | identity (name/phone/website/email/address) + `attributes` JSON for case-specific fields + dedupe keys (domain, normalized phone). |
| `LeadInsight` | `analyzerKey` + typed `result` JSON (website score/issues, or any analyzer's output). One row per analyzer per lead. |
| `LeadScore` | score + band + rule trace (which rules fired). |
| `Channel` | registered channel config + credentials ref (encrypted). |
| `Template` | `channelKey` + `playbookKey` + body (email HTML / WhatsApp template id). |
| `Sequence` / `SequenceStep` | the touch plan instance per lead. |
| `OutboundMessage` | channel-agnostic send record (providerMessageId, status). |
| `EngagementEvent` | opens/clicks/replies/bounces — channel-agnostic, replaces BRD's EmailEvents. |
| `Reply` | inbound, with channel + parsed intent. |
| `Job`/`AuditLog` | pg-boss handles jobs; AuditLog for compliance. |

## 5. The pipeline = composable steps (BRD §9 workflow, made generic)

Each step is a pg-boss job. The Playbook decides which run and with what config.

```
discover(source*)  →  dedupe  →  analyze(analyzer*)  →  score  →  qualify
   →  personalize(AI)  →  buildSequence  →  send(touch, channel)  →  trackEngagement
   →  followUp(delayed jobs)  →  captureReply  →  closeLead
```

- `send` resolves `touch.channel` → Channel plugin. Email today, WhatsApp tomorrow — same step.
- Follow-ups are **delayed pg-boss jobs**; a guard cancels remaining touches on stop events.
- AI personalization uses **Claude Haiku 4.5** with a playbook-specific prompt template
  (most copy is templated; AI fills 3–4 personalized fields). System prompt prompt-cached.

## 6. Folder structure

```
app/                      # Next.js routes: dashboard + /api + /api/webhooks/:channel
worker/                   # pg-boss consumer + step handlers
core/
  playbooks/registry.ts   # name → Playbook config + hooks
  channels/               # EmailChannel.ts  (WhatsAppChannel.ts later)  + registry
  sources/                # GooglePlacesSource.ts (DirectorySource, CsvImport later)
  analyzers/              # WebsiteAnalyzer.ts (others later)
  scoring/                # declarative rule evaluator
  personalize/            # Claude client + prompt templates
  pipeline/               # step definitions, wired to pg-boss
playbooks/website-sales/  # the reference business case (config + templates + prompt)
prisma/schema.prisma
```

Adding a business case = new folder under `playbooks/` + register any new source/analyzer.
Adding a channel = new file under `core/channels/` + register it + add templates.

## 7. Phased build

1. **Foundation** — Next.js + Tailwind/shadcn, Prisma schema (§4), Neon, pg-boss, registries.
2. **Discovery + dedupe + analysis** — `GooglePlacesSource`, `WebsiteAnalyzer` (PageSpeed +
   cheerio). Validate lead quality before spending on outreach.
3. **Scoring + qualification + AI** — rule engine + Haiku personalization.
4. **Channel + sequence (email)** — `EmailChannel` (Resend), touch engine, webhooks, stop-rules.
5. **Dashboard + analytics** — leads, campaigns, funnel metrics.
6. **Reference playbook** — wire website-sales config end-to-end; prove a *second* dummy
   playbook runs with config-only changes.
7. **(Future) WhatsApp** — `WhatsAppChannel` + templates + inbound webhook; add WhatsApp
   touches to a playbook. Engine untouched.

## 8. What this buys you
- New vertical → write a Playbook config (+ maybe one analyzer). No engine changes.
- New channel → implement one interface + templates. No sequence/schema/UI changes.
- Same low-cost infra and the cost model in [requirements.md](requirements.md) still holds;
  WhatsApp adds only its provider's per-message fee when enabled.

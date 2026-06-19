// The pipeline: each step is a pg-boss job handler. The Playbook decides what runs.
// See PLAN.md §5. Steps hand off by enqueuing the next job.
import type PgBoss from "pg-boss";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { JOBS } from "./queue.js";
import { getPlaybook } from "./playbooks/index.js";
import { getSource } from "./sources/index.js";
import { getAnalyzer, type AnalysisResult } from "./analyzers/index.js";
import { buildContext, score } from "./scoring.js";
import { personalize } from "./personalize.js";
import { getChannel } from "./channels/index.js";
import { pickSenderName, senderLinksHtml } from "./sender.js";
import { discoverEmail } from "./enrich.js";
import { planAreas } from "./queryplanner.js";

const normDomain = (url?: string | null) =>
  url ? url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : null;
const normPhone = (p?: string | null) => (p ? p.replace(/\D/g, "") : null);

// Expand campaign inputs into a list of Google text queries. A city query plus one
// per area/locality the user fed in — each query pulls its own ~60 results, so more
// areas = more leads (dedup handles overlap).
function buildQueries(params: Record<string, unknown>): string[] {
  const businessType = String(params.businessType ?? "").trim();
  if (!businessType) return [];
  const city = String(params.city ?? "").trim();
  const state = String(params.state ?? "").trim();
  const country = String(params.country ?? "").trim();
  const areas = Array.isArray(params.areas) ? (params.areas as unknown[]).map(String) : [];

  const out: string[] = [];
  const cityLoc = [city, state, country].filter(Boolean).join(", ");
  if (cityLoc) out.push(`${businessType} in ${cityLoc}`);
  for (const a of areas) {
    const area = a.trim();
    if (area) out.push(`${businessType} in ${area}${city ? `, ${city}` : ""}`);
  }
  return [...new Set(out)];
}

// --- Step handlers --------------------------------------------------------

// Entry point: kick off the query chain at index 0. The chain (discoverQuery)
// advances itself one query at a time so a campaign works through its whole input
// list continuously, and can re-scan on a schedule.
async function discover(boss: PgBoss, campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;
  const params = campaign.params as Record<string, unknown>;

  // AI area expansion (once per campaign): Claude enumerates the city's localities,
  // each of which becomes its own Google query — far deeper coverage than one search.
  if (params.aiAreas === true && params.areasGenerated !== true) {
    try {
      const ai = await planAreas({
        businessType: String(params.businessType ?? ""),
        city: String(params.city ?? ""),
        state: String(params.state ?? ""),
        country: String(params.country ?? ""),
      });
      const manual = Array.isArray(params.areas) ? (params.areas as unknown[]).map(String) : [];
      const areas = [...new Set([...manual, ...ai].map((s) => s.trim()).filter(Boolean))];
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { params: { ...params, areas, areasGenerated: true } as Prisma.InputJsonValue },
      });
      console.log(`[discover] ${campaignId} AI expanded to ${areas.length} areas`);
    } catch (e) {
      console.error(`[discover] ${campaignId} AI area planning failed:`, e);
    }
  }

  await boss.send(JOBS.discoverQuery, { campaignId, index: 0 });
}

// Process ONE query, then enqueue the next. Stops when the campaign is paused or the
// query list is exhausted. If params.recurring, schedules a fresh scan in 24h.
async function discoverQuery(boss: PgBoss, campaignId: string, index: number) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "RUNNING") {
    console.log(`[discover] ${campaignId} not running — stopping chain at q${index}`);
    return;
  }
  const pb = getPlaybook(campaign.playbookKey);
  const params = campaign.params as Record<string, unknown>;
  const queries = buildQueries(params);

  if (index >= queries.length) {
    console.log(`[discover] ${campaignId} complete — ${queries.length} queries processed`);
    if (params.recurring === true) {
      await boss.send(JOBS.discover, { campaignId }, { startAfter: 24 * 3600 });
      console.log(`[discover] ${campaignId} recurring — next scan in 24h`);
    }
    return;
  }

  const perQuery = typeof params.maxLeads === "number" ? params.maxLeads : 60;
  const source = getSource(pb.discovery.sources[0].key);
  const text = queries[index];
  let created = 0;

  for await (const raw of source.discover({ text, limit: perQuery, params })) {
    const domainKey = normDomain(raw.website);
    const phoneKey = normPhone(raw.phone);

    // Dedupe within the campaign on domain or phone (when present).
    const keyFilters = [
      domainKey ? { domainKey } : null,
      phoneKey ? { phoneKey } : null,
    ].filter(Boolean) as Prisma.LeadWhereInput[];
    if (keyFilters.length) {
      const dupe = await prisma.lead.findFirst({ where: { campaignId, OR: keyFilters }, select: { id: true } });
      if (dupe) continue;
    }

    try {
      const lead = await prisma.lead.create({
        data: {
          campaignId,
          businessName: raw.businessName,
          website: raw.website,
          email: raw.email,
          phone: raw.phone,
          address: raw.address,
          category: raw.category,
          domainKey,
          phoneKey,
          attributes: (raw.attributes ?? {}) as Prisma.InputJsonValue,
        },
      });
      await boss.send(JOBS.analyze, { leadId: lead.id });
      created++;
    } catch {
      // unique constraint => duplicate (race); skip.
    }
  }

  console.log(`[discover] ${campaignId} q${index + 1}/${queries.length} "${text}" -> ${created} new leads`);
  // Advance to the next query (paced) — this is what keeps it running continuously.
  await boss.send(JOBS.discoverQuery, { campaignId, index: index + 1 }, { startAfter: 4 });
}

async function analyze(boss: PgBoss, leadId: string) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { campaign: true } });
  const pb = getPlaybook(lead.campaign.playbookKey);
  for (const ref of pb.analyzers) {
    const analyzer = getAnalyzer(ref.key);
    const result = await analyzer.analyze({
      id: lead.id,
      website: lead.website,
      phone: lead.phone,
      attributes: lead.attributes as Record<string, unknown>,
    });
    await prisma.leadInsight.upsert({
      where: { leadId_analyzerKey: { leadId, analyzerKey: result.analyzerKey } },
      create: { leadId, analyzerKey: result.analyzerKey, result: result as unknown as Prisma.InputJsonValue },
      update: { result: result as unknown as Prisma.InputJsonValue },
    });
  }

  // Email enrichment: Places gives no email, so scrape the site for one.
  if (!lead.email && lead.website) {
    const email = await discoverEmail(lead.website);
    if (email) await prisma.lead.update({ where: { id: leadId }, data: { email } });
  }

  await boss.send(JOBS.score, { leadId });
}

async function scoreStep(boss: PgBoss, leadId: string) {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { campaign: true, insights: true },
  });
  const pb = getPlaybook(lead.campaign.playbookKey);
  const analyses = lead.insights.map((i) => i.result as unknown as AnalysisResult);
  const ctx = buildContext({ category: lead.category }, analyses);
  const out = score(ctx, pb.scoring);

  await prisma.leadScore.upsert({
    where: { leadId },
    create: { leadId, score: out.score, band: out.band, trace: out.trace },
    update: { score: out.score, band: out.band, trace: out.trace },
  });

  if (out.band === pb.qualification.excludeBand) {
    await prisma.lead.update({ where: { id: leadId }, data: { status: "CLOSED" } });
    return;
  }
  await boss.send(JOBS.personalize, { leadId });
}

async function personalizeStep(boss: PgBoss, leadId: string) {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { campaign: true, insights: true },
  });
  const pb = getPlaybook(lead.campaign.playbookKey);
  const website = lead.insights.find((i) => i.analyzerKey === "website")?.result as
    | { issues?: string[]; data?: { status?: string } }
    | undefined;
  const analysisSummary = website
    ? `status=${(website as { data?: { status?: string } }).data?.status}; issues=${(website.issues ?? []).join(", ")}`
    : "no analysis";

  const result = await personalize({
    businessName: lead.businessName,
    category: lead.category,
    analysisSummary,
    offer: pb.personalization.offer,
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      attributes: {
        ...(lead.attributes as object),
        personalization: result,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await boss.send(JOBS.buildSequence, { leadId });
}

async function buildSequence(boss: PgBoss, leadId: string) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { campaign: true } });
  const pb = getPlaybook(lead.campaign.playbookKey);
  const now = Date.now();

  const sequence = await prisma.sequence.create({
    data: {
      leadId,
      steps: {
        create: pb.sequence.map((t) => ({
          day: t.day,
          channelKey: t.channel,
          templateKey: t.templateKey,
          scheduledFor: new Date(now + t.day * 86_400_000),
        })),
      },
    },
    include: { steps: true },
  });

  // Schedule each touch as a delayed job. Follow-ups fire on their day.
  for (const step of sequence.steps) {
    await boss.sendAfter(JOBS.sendTouch, { stepId: step.id }, {}, step.scheduledFor);
  }
}

async function sendTouch(boss: PgBoss, stepId: string) {
  const step = await prisma.sequenceStep.findUniqueOrThrow({
    where: { id: stepId },
    include: { sequence: { include: { lead: { include: { campaign: true } } } } },
  });
  if (step.status !== "PENDING") return;

  const lead = step.sequence.lead;
  // Stop-rule guard: if the lead already replied/bounced/unsubscribed, cancel.
  const stopped = ["REPLIED", "UNSUBSCRIBED", "BOUNCED", "INTERESTED", "NOT_INTERESTED"].includes(lead.status);
  if (stopped || step.sequence.status !== "ACTIVE") {
    await prisma.sequenceStep.update({ where: { id: stepId }, data: { status: "CANCELLED" } });
    return;
  }

  // Live-send gate: nothing goes out unless the campaign has live sending enabled.
  // Safe by default — discovery/scoring/personalization still run, sends are skipped.
  const liveSend = (lead.campaign.params as { liveSend?: boolean }).liveSend === true;
  if (!liveSend) {
    await prisma.sequenceStep.update({ where: { id: stepId }, data: { status: "SKIPPED" } });
    return;
  }

  // No email to send to → skip (don't consume a throttle slot).
  if (!lead.email) {
    await prisma.sequenceStep.update({ where: { id: stepId }, data: { status: "SKIPPED" } });
    return;
  }

  // Slow, paced sending to protect domain reputation: global daily cap + spacing
  // between sends. Over the limit / too soon → reschedule this step, don't send now.
  const intervalSec = Number(process.env.SEND_INTERVAL_SECONDS) || 180;
  const dailyCap = Number(process.env.SEND_DAILY_CAP) || 40;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const sentToday = await prisma.outboundMessage.count({
    where: { status: "sent", sentAt: { gte: dayStart } },
  });
  if (sentToday >= dailyCap) {
    const secsToTomorrow = Math.ceil((dayStart.getTime() + 86_400_000 - Date.now()) / 1000);
    await boss.send(JOBS.sendTouch, { stepId }, { startAfter: Math.max(60, secsToTomorrow) });
    return;
  }

  const last = await prisma.outboundMessage.findFirst({
    where: { status: "sent" },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (last) {
    const waitSec = Math.ceil((last.sentAt.getTime() + intervalSec * 1000 - Date.now()) / 1000);
    if (waitSec > 0) {
      await boss.send(JOBS.sendTouch, { stepId }, { startAfter: waitSec });
      return;
    }
  }

  const channel = getChannel(step.channelKey);
  const tpl = await prisma.template.findUnique({
    where: {
      playbookKey_channelKey_templateKey: {
        playbookKey: lead.campaign.playbookKey,
        channelKey: step.channelKey,
        templateKey: step.templateKey,
      },
    },
  });

  // Render: substitute lead fields + personalization into subject/body.
  const personalization =
    (lead.attributes as { personalization?: Record<string, unknown> }).personalization ?? {};
  const senderName = pickSenderName(lead.id);
  const ctx: Record<string, unknown> = {
    businessName: lead.businessName,
    senderName,
    senderCompany: process.env.SENDER_COMPANY ?? "",
    senderPhone: process.env.SENDER_PHONE ?? "",
    senderLinks: senderLinksHtml(),
    ...personalization,
  };
  const render = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = ctx[k];
      if (Array.isArray(v)) return v.map((x) => `✓ ${x}`).join("<br>");
      return v == null ? "" : String(v);
    });

  const res = await channel.send({
    to: { email: lead.email ?? undefined, phone: lead.phone ?? undefined },
    fromName: senderName || undefined,
    subject: tpl?.subject ? render(tpl.subject) : undefined,
    body: render(tpl?.body ?? "{{openingLine}}"),
  });

  await prisma.outboundMessage.create({
    data: {
      stepId,
      channelKey: step.channelKey,
      providerMessageId: res.providerMessageId,
      status: res.status,
    },
  });
  await prisma.sequenceStep.update({
    where: { id: stepId },
    data: { status: res.status === "sent" ? "SENT" : "SKIPPED" },
  });
  if (res.status === "sent" && lead.status === "NOT_CONTACTED") {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } });
  }
}

// --- Register all step workers on pg-boss --------------------------------
// pg-boss v10 hands the handler a batch (array) of jobs. We run the batch
// CONCURRENTLY (allSettled) so leads process in parallel and one failing lead
// can't block — or stop — the rest of the run.
type Job<T> = { data: T };

function parallel<T>(fn: (data: T) => Promise<void>) {
  return async (jobs: Job<T>[]) => {
    await Promise.allSettled(jobs.map((j) => fn(j.data)));
  };
}

export async function registerWorkers(boss: PgBoss): Promise<void> {
  // pg-boss v10 requires queues to exist before send/work. createQueue is idempotent.
  for (const name of Object.values(JOBS)) await boss.createQueue(name);

  // Discovery: discover() kicks the chain; discoverQuery processes one query then
  // enqueues the next (serial by default batch size, so queries are paced in order).
  await boss.work<{ campaignId: string }>(JOBS.discover, parallel((d) => discover(boss, d.campaignId)));
  await boss.work<{ campaignId: string; index: number }>(
    JOBS.discoverQuery,
    parallel((d) => discoverQuery(boss, d.campaignId, d.index)),
  );

  // Per-lead steps: process up to 10 leads at once (these do the network I/O).
  const batch = { batchSize: 10 };
  await boss.work<{ leadId: string }>(JOBS.analyze, batch, parallel((d) => analyze(boss, d.leadId)));
  await boss.work<{ leadId: string }>(JOBS.score, batch, parallel((d) => scoreStep(boss, d.leadId)));
  await boss.work<{ leadId: string }>(JOBS.personalize, batch, parallel((d) => personalizeStep(boss, d.leadId)));
  await boss.work<{ leadId: string }>(JOBS.buildSequence, batch, parallel((d) => buildSequence(boss, d.leadId)));

  // Sends: serial (batchSize 1) so the global spacing/daily-cap throttle is accurate
  // and emails trickle out slowly to protect domain reputation.
  await boss.work<{ stepId: string }>(JOBS.sendTouch, { batchSize: 1 }, parallel((d) => sendTouch(boss, d.stepId)));
}

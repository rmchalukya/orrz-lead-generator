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

const normDomain = (url?: string | null) =>
  url ? url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase() : null;
const normPhone = (p?: string | null) => (p ? p.replace(/\D/g, "") : null);

function interpolate(tpl: string, params: Record<string, unknown>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

// --- Step handlers --------------------------------------------------------

async function discover(boss: PgBoss, campaignId: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const pb = getPlaybook(campaign.playbookKey);
  const params = campaign.params as Record<string, unknown>;
  const maxLeads = typeof params.maxLeads === "number" ? params.maxLeads : 200;

  for (const srcRef of pb.discovery.sources) {
    const source = getSource(srcRef.key);
    for (const tpl of pb.discovery.queryTemplates) {
      const text = interpolate(tpl, params);
      for await (const raw of source.discover({ text, limit: maxLeads, params })) {
        const domainKey = normDomain(raw.website);
        const phoneKey = normPhone(raw.phone);

        // Dedupe within the campaign on domain or phone (when present).
        const keyFilters = [
          domainKey ? { domainKey } : null,
          phoneKey ? { phoneKey } : null,
        ].filter(Boolean) as Prisma.LeadWhereInput[];
        if (keyFilters.length) {
          const dupe = await prisma.lead.findFirst({
            where: { campaignId, OR: keyFilters },
            select: { id: true },
          });
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
        } catch {
          // unique constraint => duplicate; skip (dedupe).
        }
      }
    }
  }
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

async function sendTouch(_boss: PgBoss, stepId: string) {
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
// pg-boss v10 hands the handler a batch (array) of jobs; process each in turn.
type Job<T> = { data: T };

function handler<T>(fn: (data: T) => Promise<void>) {
  return async (jobs: Job<T>[]) => {
    for (const job of jobs) await fn(job.data);
  };
}

export async function registerWorkers(boss: PgBoss): Promise<void> {
  // pg-boss v10 requires queues to exist before send/work. createQueue is idempotent.
  for (const name of Object.values(JOBS)) await boss.createQueue(name);

  await boss.work<{ campaignId: string }>(JOBS.discover, handler((d) => discover(boss, d.campaignId)));
  await boss.work<{ leadId: string }>(JOBS.analyze, handler((d) => analyze(boss, d.leadId)));
  await boss.work<{ leadId: string }>(JOBS.score, handler((d) => scoreStep(boss, d.leadId)));
  await boss.work<{ leadId: string }>(JOBS.personalize, handler((d) => personalizeStep(boss, d.leadId)));
  await boss.work<{ leadId: string }>(JOBS.buildSequence, handler((d) => buildSequence(boss, d.leadId)));
  await boss.work<{ stepId: string }>(JOBS.sendTouch, handler((d) => sendTouch(boss, d.stepId)));
}

// Safe end-to-end demo. Runs the REAL worker pipeline on a small campaign
// (discover → analyze → score → personalize → buildSequence), then sends touch #1
// of one qualified lead to TEST_EMAIL only. Discovered businesses have no email,
// so the pipeline never emails them. Run: npm run demo
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../core/db.js";
import { getBoss, JOBS } from "../core/queue.js";
import { registerWorkers } from "../core/pipeline.js";
import { getPlaybook } from "../core/playbooks/index.js";
import { getChannel } from "../core/channels/index.js";
import { personalize } from "../core/personalize.js";
import { pickSenderName, senderLinksHtml } from "../core/sender.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TEST_EMAIL = process.env.TEST_EMAIL;

async function main() {
  if (!TEST_EMAIL) throw new Error("TEST_EMAIL not set in .env");
  const pb = getPlaybook("website-sales");

  await prisma.playbook.upsert({
    where: { key: pb.key },
    create: { key: pb.key, name: pb.name, config: pb as unknown as Prisma.InputJsonValue },
    update: { name: pb.name, config: pb as unknown as Prisma.InputJsonValue },
  });

  const campaign = await prisma.campaign.create({
    data: {
      playbookKey: pb.key,
      name: "DEMO Salons Noida",
      status: "RUNNING",
      params: {
        businessType: "Salons",
        city: "Noida",
        state: "UP",
        country: "India",
        maxLeads: 8,
      } as Prisma.InputJsonValue,
    },
  });
  console.log(`campaign ${campaign.id} created — running pipeline…\n`);

  const boss = await getBoss();
  await registerWorkers(boss);
  await boss.send(JOBS.discover, { campaignId: campaign.id });

  // Wait until all discovered leads are scored and stable.
  let stable = 0;
  let lastLeads = -1;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const leads = await prisma.lead.count({ where: { campaignId: campaign.id } });
    const scored = await prisma.leadScore.count({ where: { lead: { campaignId: campaign.id } } });
    if (leads > 0 && scored === leads) {
      stable = leads === lastLeads ? stable + 1 : 0;
      if (stable >= 2) break;
    }
    lastLeads = leads;
  }

  // Report what the pipeline produced.
  const leads = await prisma.lead.findMany({
    where: { campaignId: campaign.id },
    include: { score: true, insights: true, sequence: { include: { steps: true } } },
  });
  console.log(`discovered: ${leads.length} leads`);
  for (const l of leads) {
    const w = l.insights.find((i) => i.analyzerKey === "website")?.result as { score?: number } | undefined;
    console.log(
      `  - ${l.businessName.slice(0, 40).padEnd(40)} site=${w?.score ?? "?"} ` +
        `lead=${l.score?.score ?? "?"} band=${l.score?.band ?? "?"} ` +
        `steps=${l.sequence?.steps.length ?? 0}`,
    );
  }

  // Pick a qualified lead with personalization for the send demo.
  const qualified = leads.find(
    (l) => l.sequence && (l.attributes as { personalization?: unknown }).personalization,
  );
  let target = qualified;
  if (!target) {
    // Fallback: personalize the lowest-scoring lead inline just for the demo.
    target = [...leads].sort((a, b) => (a.score?.score ?? 0) - (b.score?.score ?? 0))[0];
    if (target) {
      const w = target.insights.find((i) => i.analyzerKey === "website")?.result as
        | { data?: { status?: string }; issues?: string[] }
        | undefined;
      const p = await personalize({
        businessName: target.businessName,
        category: target.category,
        analysisSummary: `status=${w?.data?.status}; issues=${(w?.issues ?? []).join(", ")}`,
        offer: pb.personalization.offer,
      });
      target = { ...target, attributes: { ...(target.attributes as object), personalization: p } };
    }
  }
  if (!target) throw new Error("no leads to demo with");

  // Render touch #1 (observation) and send to TEST_EMAIL only.
  const tpl = await prisma.template.findUniqueOrThrow({
    where: {
      playbookKey_channelKey_templateKey: {
        playbookKey: pb.key,
        channelKey: "email",
        templateKey: "observation",
      },
    },
  });
  const personalization =
    (target.attributes as { personalization?: Record<string, unknown> }).personalization ?? {};
  const senderName = pickSenderName(target.id);
  const ctx: Record<string, unknown> = {
    businessName: target.businessName,
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

  const subject = render(tpl.subject ?? "");
  const body = render(tpl.body);

  if (process.env.SEND === "true") {
    console.log(`\nsending touch #1 ("intro") for "${target.businessName}" to ${TEST_EMAIL}…`);
    const res = await getChannel("email").send({ to: { email: TEST_EMAIL }, fromName: senderName || undefined, subject, body });
    console.log("send result:", res);
  } else {
    // Dry run: render only, no outbound send. Set SEND=true to actually send.
    console.log(`\n--- RENDERED touch #1 for "${target.businessName}" (NOT sent) ---`);
    console.log(`To: ${TEST_EMAIL}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${body.replace(/<[^>]+>/g, "").replace(/\n{2,}/g, "\n").trim()}`);
    console.log(`--- set SEND=true to actually send ---`);
  }

  await boss.stop({ graceful: false });
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("DEMO FAIL:", e);
  process.exit(1);
});

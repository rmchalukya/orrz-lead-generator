// Seeds the website-sales email templates into the DB. Idempotent (upsert).
// Run: npm run seed
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../core/db.js";
import { getPlaybook } from "../core/playbooks/index.js";
import { websiteSalesTemplates } from "../playbooks/website-sales.templates.js";

async function main() {
  const pb = getPlaybook("website-sales");

  // Ensure the Playbook row exists (templates FK to it).
  await prisma.playbook.upsert({
    where: { key: pb.key },
    create: { key: pb.key, name: pb.name, config: pb as unknown as Prisma.InputJsonValue },
    update: { name: pb.name, config: pb as unknown as Prisma.InputJsonValue },
  });

  // Prune templates whose keys are no longer in the playbook (renamed/removed).
  const keep = websiteSalesTemplates.map((t) => t.templateKey);
  await prisma.template.deleteMany({
    where: { playbookKey: pb.key, templateKey: { notIn: keep } },
  });

  for (const t of websiteSalesTemplates) {
    await prisma.template.upsert({
      where: {
        playbookKey_channelKey_templateKey: {
          playbookKey: pb.key,
          channelKey: t.channelKey,
          templateKey: t.templateKey,
        },
      },
      create: { playbookKey: pb.key, ...t },
      update: { subject: t.subject, body: t.body },
    });
    console.log(`seeded template: ${pb.key}/${t.channelKey}/${t.templateKey}`);
  }

  await prisma.$disconnect();
  console.log(`done — ${websiteSalesTemplates.length} templates`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

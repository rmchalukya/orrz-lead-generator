// Seeds playbook email templates into the DB. Idempotent — safe to run on every
// worker boot, which guarantees the production DB always has the current templates
// (so sends never fall back to the bare "no subject" path).
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { getPlaybook } from "./playbooks/index.js";
import { websiteSalesTemplates } from "../playbooks/website-sales.templates.js";

export async function seedTemplates(): Promise<number> {
  const pb = getPlaybook("website-sales");

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
  }
  return websiteSalesTemplates.length;
}

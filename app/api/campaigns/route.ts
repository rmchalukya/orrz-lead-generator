import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../core/db.js";
import { getPlaybook } from "../../../core/playbooks/index.js";

const Body = z.object({
  playbookKey: z.string(),
  name: z.string(),
  params: z.record(z.unknown()), // { businessType, city, state, country, ... }
});

// Create a campaign for a given playbook + discovery params.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  // Validate the playbook exists (and ensure a Playbook row mirrors the registry).
  const pb = getPlaybook(parsed.data.playbookKey);
  const config = pb as unknown as Prisma.InputJsonValue;
  await prisma.playbook.upsert({
    where: { key: pb.key },
    create: { key: pb.key, name: pb.name, config },
    update: { name: pb.name, config },
  });

  const campaign = await prisma.campaign.create({
    data: {
      playbookKey: pb.key,
      name: parsed.data.name,
      params: parsed.data.params as Prisma.InputJsonValue,
    },
  });
  return Response.json(campaign, { status: 201 });
}

export async function GET() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json(campaigns);
}

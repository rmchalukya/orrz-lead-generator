import { prisma } from "../../../../../core/db.js";
import { getBoss, JOBS } from "../../../../../core/queue.js";

// Kick off the pipeline: enqueue discovery for the campaign. The worker takes it from here.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) return Response.json({ error: "not found" }, { status: 404 });

  await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
  const boss = await getBoss();
  await boss.send(JOBS.discover, { campaignId: id });

  return Response.json({ ok: true, enqueued: "discover", campaignId: id });
}

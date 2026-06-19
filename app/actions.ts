"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "../core/db.js";
import { getPlaybook } from "../core/playbooks/index.js";
import { getBoss, JOBS } from "../core/queue.js";

// Create a campaign from the dashboard form, then open its detail page.
export async function createCampaign(formData: FormData) {
  const playbookKey = String(formData.get("playbookKey") || "website-sales");
  const pb = getPlaybook(playbookKey);

  const params = {
    businessType: String(formData.get("businessType") || "").trim(),
    city: String(formData.get("city") || "").trim(),
    state: String(formData.get("state") || "").trim(),
    country: String(formData.get("country") || "").trim(),
    maxLeads: Math.max(1, Math.min(200, Number(formData.get("maxLeads") || 25))),
    liveSend: formData.get("liveSend") === "on", // unchecked = safe (no real sends)
  };
  const name = String(formData.get("name") || `${params.businessType} in ${params.city}`).trim();

  await prisma.playbook.upsert({
    where: { key: pb.key },
    create: { key: pb.key, name: pb.name, config: pb as unknown as Prisma.InputJsonValue },
    update: { name: pb.name, config: pb as unknown as Prisma.InputJsonValue },
  });

  const campaign = await prisma.campaign.create({
    data: { playbookKey: pb.key, name, params: params as Prisma.InputJsonValue },
  });

  revalidatePath("/");
  redirect(`/campaigns/${campaign.id}`);
}

// Enqueue discovery; the worker runs the rest of the pipeline.
export async function runCampaign(formData: FormData) {
  const id = String(formData.get("id"));
  await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
  const boss = await getBoss();
  await boss.send(JOBS.discover, { campaignId: id });
  revalidatePath(`/campaigns/${id}`);
}

// Toggle live email sending for a campaign (stored in params.liveSend).
export async function setLiveSend(formData: FormData) {
  const id = String(formData.get("id"));
  const on = String(formData.get("on")) === "true";
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  const params = { ...(c.params as object), liveSend: on };
  await prisma.campaign.update({
    where: { id },
    data: { params: params as Prisma.InputJsonValue },
  });
  revalidatePath(`/campaigns/${id}`);
}

export async function setCampaignStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as "PAUSED" | "RUNNING" | "ARCHIVED";
  await prisma.campaign.update({ where: { id }, data: { status } });
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/");
}

import { Prisma } from "@prisma/client";
import { prisma } from "../../../../core/db.js";
import { getChannel } from "../../../../core/channels/index.js";

// Channel-agnostic inbound webhook: /api/webhooks/email, /api/webhooks/whatsapp, ...
// The channel plugin parses provider-specific payloads into our WebhookEvent shape.
export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel: channelKey } = await params;
  const channel = getChannel(channelKey);
  const raw = await req.text();
  const headers = Object.fromEntries(req.headers.entries());

  let events;
  try {
    events = channel.verifyWebhook(raw, headers);
  } catch {
    return Response.json({ error: "invalid webhook" }, { status: 400 });
  }

  for (const evt of events) {
    if (!evt.providerMessageId) continue;
    const outbound = await prisma.outboundMessage.findFirst({
      where: { providerMessageId: evt.providerMessageId },
      include: { step: { include: { sequence: true } } },
    });
    if (!outbound) continue;

    await prisma.engagementEvent.create({
      data: {
        outboundId: outbound.id,
        channelKey,
        type: evt.type,
        payload: evt.payload as Prisma.InputJsonValue,
      },
    });

    // Update lead status + stop the sequence on terminal events.
    const leadId = (await prisma.sequence.findUnique({ where: { id: outbound.step.sequenceId } }))?.leadId;
    if (!leadId) continue;

    const statusMap: Record<string, string> = {
      opened: "OPENED",
      clicked: "CLICKED",
      bounced: "BOUNCED",
      unsubscribed: "UNSUBSCRIBED",
      replied: "REPLIED",
    };
    const newStatus = statusMap[evt.type];
    if (newStatus) {
      await prisma.lead.update({ where: { id: leadId }, data: { status: newStatus as never } });
    }
    if (["bounced", "unsubscribed", "replied"].includes(evt.type)) {
      await prisma.sequence.update({ where: { id: outbound.step.sequenceId }, data: { status: "STOPPED" } });
    }
  }

  return Response.json({ ok: true, processed: events.length });
}

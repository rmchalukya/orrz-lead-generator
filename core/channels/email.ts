import { Resend } from "resend";
import type { Channel, OutboundMessage, SendResult, WebhookEvent } from "./index.js";

// Email channel backed by Resend. Resend's webhook gives opens/clicks/bounces/etc.
export class EmailChannel implements Channel {
  key = "email" as const;
  capabilities = { supportsHtml: true, supportsOpenTracking: true, perDayLimit: 100 };

  // Constructed lazily — a missing API key must not break app/worker boot.
  private _client?: Resend;
  private client(): Resend {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
    return (this._client ??= new Resend(process.env.RESEND_API_KEY));
  }

  // Bare email address from RESEND_FROM (which may be "Name <addr>").
  private fromAddress(): string {
    const f = process.env.RESEND_FROM ?? "onboarding@resend.dev";
    return f.match(/<([^>]+)>/)?.[1] ?? f;
  }

  async send(input: OutboundMessage): Promise<SendResult> {
    if (!input.to.email) return { providerMessageId: "", status: "failed", error: "no email" };
    // Per-lead display name when provided; otherwise the configured RESEND_FROM.
    const from = input.fromName
      ? `${input.fromName} <${this.fromAddress()}>`
      : process.env.RESEND_FROM ?? this.fromAddress();
    try {
      const res = await this.client().emails.send({
        from,
        to: input.to.email,
        subject: input.subject ?? "",
        html: input.body,
      });
      if (res.error) return { providerMessageId: "", status: "failed", error: res.error.message };
      return { providerMessageId: res.data?.id ?? "", status: "sent" };
    } catch (e) {
      return { providerMessageId: "", status: "failed", error: String(e) };
    }
  }

  // Maps Resend webhook events to our channel-agnostic shape.
  // TODO: verify signature with RESEND_WEBHOOK_SECRET (svix) before trusting payload.
  verifyWebhook(rawBody: string): WebhookEvent[] {
    const evt = JSON.parse(rawBody) as { type: string; data?: { email_id?: string } };
    const map: Record<string, WebhookEvent["type"]> = {
      "email.delivered": "delivered",
      "email.opened": "opened",
      "email.clicked": "clicked",
      "email.bounced": "bounced",
      "email.complained": "unsubscribed",
    };
    const type = map[evt.type];
    if (!type) return [];
    return [{ providerMessageId: evt.data?.email_id, type, payload: evt as Record<string, unknown> }];
  }
}

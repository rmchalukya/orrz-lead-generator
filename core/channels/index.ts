// Channel = pluggable outreach. The sequence engine resolves channels by key and
// never imports a provider directly. Add WhatsApp/SMS/LinkedIn by implementing this
// interface and registering it — no engine/schema/UI changes. See PLAN.md §2.2.
import { EmailChannel } from "./email.js";

export interface OutboundMessage {
  to: { email?: string; phone?: string; handle?: string };
  subject?: string; // email only
  body: string; // rendered HTML / text / WhatsApp template ref
  fromName?: string; // per-lead sender display name (overrides the default)
  meta?: Record<string, unknown>;
}

export interface SendResult {
  providerMessageId: string;
  status: "sent" | "failed";
  error?: string;
}

export interface WebhookEvent {
  providerMessageId?: string;
  type: "delivered" | "opened" | "clicked" | "bounced" | "replied" | "unsubscribed";
  payload: Record<string, unknown>;
}

export interface Channel {
  key: "email" | "whatsapp" | "sms" | "linkedin";
  capabilities: {
    supportsHtml: boolean;
    supportsOpenTracking: boolean;
    perDayLimit?: number;
  };
  send(input: OutboundMessage): Promise<SendResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string>): WebhookEvent[];
}

// --- Registry -------------------------------------------------------------
const registry = new Map<string, Channel>();

export function registerChannel(channel: Channel): void {
  registry.set(channel.key, channel);
}

export function getChannel(key: string): Channel {
  const c = registry.get(key);
  if (!c) throw new Error(`Channel not registered: ${key}`);
  return c;
}

export function listChannels(): Channel[] {
  return [...registry.values()];
}

// Register built-in channels. WhatsApp etc. get added here later.
registerChannel(new EmailChannel());

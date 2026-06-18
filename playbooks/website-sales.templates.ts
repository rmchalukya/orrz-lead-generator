// Email templates for the website-sales sequence.
//
// Strategy (highest reply-rate cold flow): lead with a genuine OBSERVATION and
// curiosity, hold pricing until email #3, and make the CTA a one-word reply.
//   1 observation — a real finding, no price, "want me to send an example?"
//   2 mockup      — offer the personalized example, reply "show me"
//   3 offer       — NOW introduce 90 minutes / ₹999
//   4 reminder    — gentle, low-pressure nudge
//   5 breakup     — graceful close
//
// Placeholders {{...}} are filled at send time from:
//   - the lead:              {{businessName}}
//   - AI personalization:    {{subject}} {{openingLine}} {{observation}} {{missingItems}} {{ctaLine}}
//   - sender identity (env): {{senderName}} {{senderCompany}} {{senderPhone}} {{senderLinks}}
export interface SeedTemplate {
  channelKey: string;
  templateKey: string;
  subject?: string;
  body: string;
}

// Plain, personal email — no images, no buttons, no heavy styling. Reads like a
// real person typed it, which is what lifts opens, replies, and inbox placement.
const note = (paragraphs: string[]) =>
  `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">` +
  paragraphs.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join("") +
  `<p style="margin:18px 0 0;color:#444">Regards,<br>{{senderName}}<br>{{senderCompany}}<br>{{senderPhone}}<br>{{senderLinks}}</p>` +
  `<p style="margin:20px 0 0;color:#999;font-size:12px">Not relevant? Reply "stop" and I won't email again.</p>` +
  `</div>`;

export const websiteSalesTemplates: SeedTemplate[] = [
  {
    channelKey: "email",
    templateKey: "observation",
    subject: "{{subject}}", // AI-written, curiosity-driven, no price
    body: note([
      "Hi,",
      "{{openingLine}}",
      "{{observation}}",
      "I put together a quick example of how this could look online, and thought it might be useful for you to see.",
      "{{ctaLine}}",
    ]),
  },
  {
    channelKey: "email",
    templateKey: "mockup",
    subject: "re: {{subject}}",
    body: note([
      "Hi,",
      "Following up on my note about {{businessName}}. The main things a new customer can't quickly see when they find you online:",
      "{{missingItems}}",
      "I've made a small example specifically for your business showing how this could look.",
      'If you\'d like to see it, just reply "show me" and I\'ll send it across.',
    ]),
  },
  {
    channelKey: "email",
    templateKey: "offer",
    subject: "building this for {{businessName}}",
    body: note([
      "Hi,",
      "If the idea looked useful — we can build the full thing for {{businessName}} and have it live in about 90 minutes, starting at ₹999.",
      "It includes a mobile-friendly site, WhatsApp enquiry, your services and pricing, Google Maps and customer reviews.",
      "Want me to get it started for you?",
    ]),
  },
  {
    channelKey: "email",
    templateKey: "reminder",
    subject: "still keen on the {{businessName}} site?",
    body: note([
      "Hi,",
      "Just a quick reminder — the 90-minute setup for {{businessName}} is still open, starting at ₹999.",
      'If the timing is right, I can have it live today. Reply "yes" and I\'ll begin.',
    ]),
  },
  {
    channelKey: "email",
    templateKey: "breakup",
    subject: "should I close your file?",
    body: note([
      "Hi,",
      "I've reached out a couple of times about a quick website for {{businessName}} — I don't want to keep cluttering your inbox.",
      'If you\'d still like it, just reply "yes" and I\'ll get started. Otherwise no worries at all — I\'ll close the file here and won\'t follow up again.',
    ]),
  },
];

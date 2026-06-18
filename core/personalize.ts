// AI personalization (BRD Module D). Uses Claude Haiku 4.5 — cheapest capable tier — with
// a structured-output schema. Most copy is templated; the model fills a few fields per lead.
// See requirements.md cost model (~$2-3 per 1,000 leads).
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface PersonalizationInput {
  businessName: string;
  category?: string | null;
  analysisSummary: string; // issues + status, condensed
  offer: Record<string, unknown>;
}

export interface PersonalizationOutput {
  subject: string; // curiosity-driven, NO price, NO buzzwords
  openingLine: string; // "I was looking at X on Google and noticed…"
  observation: string; // the specific gap + why it costs them enquiries
  missingItems: string[]; // 3-4 short phrases a customer can't easily see
  ctaLine: string; // low-commitment question offering to send an example
}

export async function personalize(input: PersonalizationInput): Promise<PersonalizationOutput> {
  const res = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    // Stable system prompt is prompt-cached across leads (see shared/prompt-caching.md).
    system: [
      {
        type: "text",
        text: [
          "You are a helpful local consultant writing the FIRST email of a sequence to a small business owner.",
          "This email must NOT feel like a sales email — it's a genuine observation. Owners get dozens of sales emails a week; yours should feel personal and helpful.",
          "Hard rules:",
          "- Do NOT mention price, ₹999, packages, discounts, or any offer. (Pricing comes in a later email, not this one.)",
          "- No marketing buzzwords (cutting-edge, boost, supercharge, leverage, solutions, game-changer). No exclamation marks.",
          "- Specific and real — reference what you actually found. Never generic. Short enough to read in 20 seconds.",
          "Given a business and its website analysis, produce JSON with these keys:",
          "- subject: a calm, curiosity-driven line. NO price, NO buzzwords. e.g. \"Quick observation about {business}\" or \"One thing I noticed about your Google presence\".",
          "- openingLine: one sentence like \"I was looking at {business} on Google and noticed something that may be costing you enquiries.\" — adapted to the real finding.",
          "- observation: 1-2 plain sentences on the specific gap and why it matters when someone searches for a business like theirs nearby.",
          "- missingItems: 3-4 SHORT phrases (2-4 words each) a potential customer can't easily see online — e.g. \"Services offered\", \"Pricing\", \"WhatsApp enquiry\", \"Popular treatments\".",
          "- ctaLine: a low-commitment question offering to send a quick example/mockup, inviting a one-word reply. e.g. \"Would you like me to send it over?\".",
          "Respond with ONLY the JSON object — no prose, no markdown fences.",
        ].join("\n"),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content:
          `Business: ${input.businessName} (${input.category ?? "unknown category"})\n` +
          `Analysis: ${input.analysisSummary}\n` +
          `Offer: ${JSON.stringify(input.offer)}`,
      },
    ],
  });

  const block = res.content.find((b) => b.type === "text");
  const text = block && "text" in block ? block.text : "{}";
  // Strip any accidental code fences before parsing.
  const json = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(json) as PersonalizationOutput;
}

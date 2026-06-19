// AI query planning. Claude knows local geography, so given a city it enumerates the
// distinct neighborhoods / sectors / sub-localities worth searching — each becomes its
// own Google query, going far deeper than a single city-wide search (which caps at ~60).
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function planAreas(input: {
  businessType: string;
  city: string;
  state?: string;
  country?: string;
  count?: number;
}): Promise<string[]> {
  const count = input.count ?? 30;
  const loc = [input.city, input.state, input.country].filter(Boolean).join(", ");

  const res = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1200,
    system: [
      {
        type: "text",
        text:
          "You are a local-geography expert helping target a lead-generation search. " +
          "Given a city, list distinct neighborhoods, sectors, markets, or sub-localities " +
          "someone would use to search Google Maps for local businesses there. Favour " +
          "specific, well-known local area names where small/independent businesses cluster. " +
          "Respond with ONLY a JSON array of short location strings — no prose, no markdown.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content:
          `Business type: ${input.businessType}\nLocation: ${loc}\n` +
          `List up to ${count} distinct localities/areas within ${input.city} to search for ` +
          `"${input.businessType}". Return a JSON array of strings only.`,
      },
    ],
  });

  const block = res.content.find((b) => b.type === "text");
  const text = block && "text" in block ? block.text : "[]";
  const json = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) {
      return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))].slice(0, count);
    }
  } catch {
    // model returned non-JSON — fall through
  }
  return [];
}

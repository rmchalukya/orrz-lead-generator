import type { DiscoveryQuery, LeadSource, RawLead } from "./index.js";

// Google Places API (New) — Text Search. Field mask is set to pull contact fields in
// one call where possible, to avoid a per-lead Place Details charge (see requirements.md
// cost model §"optimizations"). Pagination via nextPageToken.
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.types",
  "nextPageToken",
].join(",");

export class GooglePlacesSource implements LeadSource {
  key = "google-places";

  async *discover(query: DiscoveryQuery): AsyncIterable<RawLead> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is required");

    let pageToken: string | undefined;
    let yielded = 0;

    do {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: query.text,
          ...(pageToken ? { pageToken } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);

      const data = (await res.json()) as {
        places?: Array<{
          displayName?: { text?: string };
          formattedAddress?: string;
          websiteUri?: string;
          nationalPhoneNumber?: string;
          types?: string[];
        }>;
        nextPageToken?: string;
      };

      for (const p of data.places ?? []) {
        if (yielded >= query.limit) return;
        yield {
          businessName: p.displayName?.text ?? "Unknown",
          website: p.websiteUri,
          phone: p.nationalPhoneNumber,
          address: p.formattedAddress,
          category: p.types?.[0],
          attributes: { types: p.types ?? [] },
        };
        yielded++;
      }
      pageToken = data.nextPageToken;
    } while (pageToken && yielded < query.limit);
  }
}

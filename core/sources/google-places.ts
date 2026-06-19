import type { DiscoveryQuery, LeadSource, RawLead } from "./index.js";

// Google Places API (New) — Text Search. Field mask pulls contact fields in one call
// to avoid a per-lead Place Details charge (see requirements.md cost model). Paginates
// via nextPageToken, with retries so a transient page error doesn't truncate the run.
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.types",
  "nextPageToken",
].join(",");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PlacesPage {
  places?: Array<{
    displayName?: { text?: string };
    formattedAddress?: string;
    websiteUri?: string;
    nationalPhoneNumber?: string;
    types?: string[];
  }>;
  nextPageToken?: string;
}

export class GooglePlacesSource implements LeadSource {
  key = "google-places";

  // Fetch one page with up to 3 attempts. Retries on 429/5xx and network errors;
  // returns null (caller stops paginating, keeps what it has) on hard failure.
  private async fetchPage(apiKey: string, textQuery: string, pageToken?: string): Promise<PlacesPage | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify({ textQuery, ...(pageToken ? { pageToken } : {}) }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) return (await res.json()) as PlacesPage;
        if (res.status === 429 || res.status >= 500) {
          await sleep(1200 * (attempt + 1)); // throttled / transient — back off and retry
          continue;
        }
        console.error(`[places] ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null; // non-retryable (e.g. 400/403)
      } catch {
        await sleep(1200 * (attempt + 1)); // network/timeout — retry
      }
    }
    return null;
  }

  async *discover(query: DiscoveryQuery): AsyncIterable<RawLead> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is required");

    let pageToken: string | undefined;
    let yielded = 0;

    do {
      const data = await this.fetchPage(apiKey, query.text, pageToken);
      if (!data) break; // failed page after retries — stop, keep what we yielded

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
      // New-API page tokens need a moment to become valid; also paces requests.
      if (pageToken) await sleep(1500);
    } while (pageToken && yielded < query.limit);
  }
}

// LeadSource = pluggable discovery. Google Places now; directories/CSV/scrape later.
// See PLAN.md §2.3.
import { GooglePlacesSource } from "./google-places.js";

export interface DiscoveryQuery {
  text: string; // e.g. "dentists in Mumbai"
  limit: number;
  params: Record<string, unknown>;
}

export interface RawLead {
  businessName: string;
  website?: string;
  email?: string;
  phone?: string;
  address?: string;
  category?: string;
  attributes?: Record<string, unknown>;
}

export interface LeadSource {
  key: string;
  discover(query: DiscoveryQuery): AsyncIterable<RawLead>;
}

const registry = new Map<string, LeadSource>();
export function registerSource(s: LeadSource): void {
  registry.set(s.key, s);
}
export function getSource(key: string): LeadSource {
  const s = registry.get(key);
  if (!s) throw new Error(`Source not registered: ${key}`);
  return s;
}

registerSource(new GooglePlacesSource());

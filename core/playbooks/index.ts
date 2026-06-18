// Playbook = a business case as config. The engine is generic; a new vertical is a new
// Playbook (+ maybe a new source/analyzer). See PLAN.md §2.1.
import type { ScoringConfig } from "../scoring.js";
import { websiteSales } from "../../playbooks/website-sales.js";

export interface SourceRef { key: string; params?: Record<string, unknown> }
export interface AnalyzerRef { key: string; params?: Record<string, unknown> }

export interface TouchDef {
  day: number;
  channel: "email" | "whatsapp" | "sms" | "linkedin";
  templateKey: string;
  stopOn: Array<"replied" | "bounced" | "unsubscribed">;
}

export interface Playbook {
  key: string;
  name: string;
  discovery: { sources: SourceRef[]; queryTemplates: string[] };
  analyzers: AnalyzerRef[];
  scoring: ScoringConfig;
  qualification: { excludeBand: string };
  personalization: { promptKey: string; offer: Record<string, unknown> };
  sequence: TouchDef[];
}

const registry = new Map<string, Playbook>();
export function registerPlaybook(p: Playbook): void {
  registry.set(p.key, p);
}
export function getPlaybook(key: string): Playbook {
  const p = registry.get(key);
  if (!p) throw new Error(`Playbook not registered: ${key}`);
  return p;
}
export function listPlaybooks(): Playbook[] {
  return [...registry.values()];
}

registerPlaybook(websiteSales);

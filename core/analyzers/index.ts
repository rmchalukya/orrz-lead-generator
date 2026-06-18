// Analyzer = pluggable qualification signal. WebsiteAnalyzer ships first; a different
// business case registers different analyzers (review volume, tech stack, ...).
// See PLAN.md §2.3.
import { WebsiteAnalyzer } from "./website.js";

export interface LeadLike {
  id: string;
  website?: string | null;
  phone?: string | null;
  attributes: Record<string, unknown>;
}

export interface AnalysisResult {
  analyzerKey: string;
  // Free-form typed result; convention: include a numeric `score` (0-100) and `issues`.
  score?: number;
  issues?: string[];
  data: Record<string, unknown>;
}

export interface Analyzer {
  key: string;
  analyze(lead: LeadLike): Promise<AnalysisResult>;
}

const registry = new Map<string, Analyzer>();
export function registerAnalyzer(a: Analyzer): void {
  registry.set(a.key, a);
}
export function getAnalyzer(key: string): Analyzer {
  const a = registry.get(key);
  if (!a) throw new Error(`Analyzer not registered: ${key}`);
  return a;
}

registerAnalyzer(new WebsiteAnalyzer());

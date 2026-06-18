// Declarative scoring + qualification driven by Playbook config. See PLAN.md §2.1 / §5.
// Rules operate over a flat context built from the lead + its analysis results.
import type { AnalysisResult } from "./analyzers/index.js";

export interface ScoringRule {
  id: string;
  // A tiny, safe expression evaluated against the context (no eval of arbitrary code):
  // { fact: "website.score", op: "<", value: 50, points: 40 }
  fact: string;
  op: "<" | "<=" | ">" | ">=" | "==" | "!=" | "exists" | "missing";
  value?: number | string;
  points: number;
}

export interface Band {
  band: string; // "P1" | "P2" | "P3" | "EXCLUDE"
  // band applies when score is within [min, max]
  min: number;
  max: number;
}

export interface ScoringConfig {
  rules: ScoringRule[];
  bands: Band[];
}

export interface ScoreOutput {
  score: number;
  band: string;
  trace: Array<{ ruleId: string; points: number }>;
}

function getFact(ctx: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
    return undefined;
  }, ctx);
}

function test(rule: ScoringRule, actual: unknown): boolean {
  switch (rule.op) {
    case "exists": return actual !== undefined && actual !== null;
    case "missing": return actual === undefined || actual === null;
    case "==": return actual === rule.value;
    case "!=": return actual !== rule.value;
    default: {
      const a = Number(actual);
      const b = Number(rule.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (rule.op === "<") return a < b;
      if (rule.op === "<=") return a <= b;
      if (rule.op === ">") return a > b;
      if (rule.op === ">=") return a >= b;
      return false;
    }
  }
}

// Builds context like { website: { score, status, issues }, lead: {...} }
export function buildContext(
  lead: Record<string, unknown>,
  analyses: AnalysisResult[],
): Record<string, unknown> {
  const ctx: Record<string, unknown> = { lead };
  for (const a of analyses) {
    ctx[a.analyzerKey] = { score: a.score, issues: a.issues, ...a.data };
  }
  return ctx;
}

export function score(ctx: Record<string, unknown>, cfg: ScoringConfig): ScoreOutput {
  let total = 0;
  const trace: ScoreOutput["trace"] = [];
  for (const rule of cfg.rules) {
    if (test(rule, getFact(ctx, rule.fact))) {
      total += rule.points;
      trace.push({ ruleId: rule.id, points: rule.points });
    }
  }
  total = Math.max(0, Math.min(100, total));
  const band = cfg.bands.find((b) => total >= b.min && total <= b.max)?.band ?? "EXCLUDE";
  return { score: total, band, trace };
}

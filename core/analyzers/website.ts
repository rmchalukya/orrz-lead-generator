import * as cheerio from "cheerio";
import type { Analyzer, AnalysisResult, LeadLike } from "./index.js";

// Website quality analyzer (BRD Module B). Free: own fetch + cheerio for structure/contact/
// SEO checks; Google PageSpeed Insights API (free) for performance + mobile. Produces a
// 0-100 score and an issues list. No website => score 0, status NONE.
const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export class WebsiteAnalyzer implements Analyzer {
  key = "website";

  async analyze(lead: LeadLike): Promise<AnalysisResult> {
    const url = lead.website;
    if (!url) {
      return {
        analyzerKey: this.key,
        score: 0,
        issues: ["No Website"],
        data: { status: "NONE" },
      };
    }

    const issues: string[] = [];
    let html = "";
    let reachable = true;
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
      reachable = res.ok;
      html = await res.text();
    } catch {
      reachable = false;
    }
    if (!reachable) {
      return { analyzerKey: this.key, score: 10, issues: ["Website Not Accessible"], data: { status: "POOR" } };
    }

    const $ = cheerio.load(html);
    const hasViewport = $('meta[name="viewport"]').length > 0;
    const hasTitle = $("title").text().trim().length > 0;
    const hasMetaDesc = $('meta[name="description"]').length > 0;
    const hasForm = $("form").length > 0;
    const hasWhatsApp = /wa\.me|whatsapp/i.test(html);
    const hasSchema = /application\/ld\+json/i.test(html);

    if (!hasViewport) issues.push("Not Mobile-Friendly");
    if (!hasTitle) issues.push("Missing Meta Title");
    if (!hasMetaDesc) issues.push("Missing Meta Description");
    if (!hasForm) issues.push("Missing Contact Form");
    if (!hasWhatsApp) issues.push("No WhatsApp Integration");
    if (!hasSchema) issues.push("No Schema Markup");

    // Performance via PageSpeed (best-effort; skip silently if no key / rate limited).
    let perf = 0.6;
    try {
      const key = process.env.GOOGLE_PLACES_API_KEY; // PSI accepts any Google API key
      const psiUrl = `${PSI}?url=${encodeURIComponent(url)}&strategy=mobile${key ? `&key=${key}` : ""}`;
      const res = await fetch(psiUrl, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        const data = (await res.json()) as { lighthouseResult?: { categories?: { performance?: { score?: number } } } };
        perf = data.lighthouseResult?.categories?.performance?.score ?? perf;
        if (perf < 0.5) issues.push("Slow Loading");
      }
    } catch { /* ignore */ }

    // Simple weighted score: structure/contact/SEO checks + performance.
    const checks = [hasViewport, hasTitle, hasMetaDesc, hasForm, hasWhatsApp, hasSchema];
    const structureScore = (checks.filter(Boolean).length / checks.length) * 60;
    const score = Math.round(structureScore + perf * 40);
    const status = score >= 70 ? "GOOD" : score >= 50 ? "AVERAGE" : "POOR";

    return { analyzerKey: this.key, score, issues, data: { status, performance: perf } };
  }
}

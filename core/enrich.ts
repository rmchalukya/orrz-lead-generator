// Email enrichment. Google Places returns a website + phone but not an email, so we
// scrape the business's own site (homepage + common contact pages) for a contact
// address. Best-effort: returns null if nothing credible is found.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Reject obvious non-contact / placeholder / asset-derived matches.
const SKIP =
  /\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|@sentry|@2x|example\.(com|org)|yourdomain|your-?email|no-?reply|@email\.|@domain\.|placeholder|user@|name@/i;

function pickEmail(html: string, domain: string): string | null {
  const found = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(m[1].toLowerCase());
  for (const m of html.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());

  const candidates = [...found].filter((e) => !SKIP.test(e));
  if (candidates.length === 0) return null;

  // Prefer an address on the business's own domain (most likely the real inbox).
  const onDomain = candidates.find((e) => e.split("@")[1]?.endsWith(domain));
  return onDomain ?? candidates[0];
}

export async function discoverEmail(website: string): Promise<string | null> {
  let domain = "";
  try {
    domain = new URL(website).host.replace(/^www\./, "");
  } catch {
    return null;
  }

  // Homepage first, then the usual contact pages.
  for (const path of ["", "/contact", "/contact-us", "/about", "/about-us"]) {
    try {
      const url = new URL(path, website).toString();
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const email = pickEmail(await res.text(), domain);
      if (email) return email;
    } catch {
      // unreachable page — try the next one
    }
  }
  return null;
}

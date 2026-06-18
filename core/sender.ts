// Picks the sender's display name for a lead. If SENDER_NAME_POOL is set (comma-
// separated), the name is chosen DETERMINISTICALLY from the lead id — so the same
// prospect always sees the same sender across every email in the sequence (a
// different name per touch would break the personal feel and read as a bot).
//
// ⚠️ Use names of REAL people on your team. A fabricated "From" identity can be
// deceptive and runs against anti-spam rules (sender info must be accurate) — and
// if a prospect notices, it destroys the trust the personal style is meant to build.
export function pickSenderName(seed: string): string {
  const pool = (process.env.SENDER_NAME_POOL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (pool.length === 0) return process.env.SENDER_NAME ?? "";

  // Stable hash of the seed → index (no randomness, so it's reproducible).
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

// Renders SENDER_WEBSITE (one or more comma-separated URLs) as clickable links
// for the email signature, one per line.
export function senderLinksHtml(): string {
  return (process.env.SENDER_WEBSITE ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => `<a href="${u}" style="color:#2563eb">${u}</a>`)
    .join("<br>");
}

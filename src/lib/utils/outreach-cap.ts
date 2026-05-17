// OUTREACH FREQUENCY CAP — roadmap Tier 7.2
//
// Per-lead: refuse to generate / send new outreach if the previous one is
// less than 90 days old. The cap is meant to protect deliverability
// (sending the same lead multiple emails in a window torches the sender
// domain's reputation) and to enforce GDPR's reasonable-frequency
// expectation for B2B outreach without explicit consent.
//
// Per-domain: a soft cap of 5 outreach actions per email/website domain
// per rolling 7 days. Above that we warn rather than block — the user
// can override if they have a legitimate business reason.

const DEFAULT_PER_LEAD_DAYS = 90;
const DEFAULT_PER_DOMAIN_PER_7D = 5;

export interface OutreachCapDecision {
  allowed: boolean;
  reason?: string;
  retry_after?: string;          // ISO date when allowed again
  days_since_last?: number;
}

export function checkPerLeadCap(
  lastGeneratedAt: string | null | undefined,
  capDays: number = DEFAULT_PER_LEAD_DAYS
): OutreachCapDecision {
  if (!lastGeneratedAt) return { allowed: true };
  const last = new Date(lastGeneratedAt).getTime();
  if (!Number.isFinite(last)) return { allowed: true };
  const now = Date.now();
  const ageMs = now - last;
  const ageDays = ageMs / 86_400_000;
  if (ageDays >= capDays) return { allowed: true, days_since_last: Math.floor(ageDays) };
  const retryAfter = new Date(last + capDays * 86_400_000).toISOString();
  return {
    allowed: false,
    reason: `Per-lead frequency cap: this lead had outreach ${Math.floor(ageDays)} day(s) ago. Wait until ${retryAfter.slice(0, 10)} (${capDays}-day cap).`,
    retry_after: retryAfter,
    days_since_last: Math.floor(ageDays),
  };
}

export interface DomainCapInput {
  // The lead about to be contacted
  email?: string | null;
  website_url?: string | null;
  // Peer leads already contacted in the last 7 days (caller fetches them)
  recent_contacts: Array<{ email?: string | null; website_url?: string | null }>;
}

export function checkPerDomainCap(
  input: DomainCapInput,
  cap: number = DEFAULT_PER_DOMAIN_PER_7D
): OutreachCapDecision {
  const targetDomain = extractDomain(input.email) ?? extractDomain(input.website_url);
  if (!targetDomain) return { allowed: true };
  const count = input.recent_contacts.filter((c) => {
    const d = extractDomain(c.email) ?? extractDomain(c.website_url);
    return d === targetDomain;
  }).length;
  if (count < cap) return { allowed: true };
  return {
    allowed: false,
    reason: `Per-domain frequency cap: ${count} outreaches already sent to ${targetDomain} in the last 7 days (cap ${cap}). Wait, or override.`,
  };
}

function extractDomain(s: string | null | undefined): string | null {
  if (!s) return null;
  if (s.includes("@")) return s.split("@")[1]?.toLowerCase() ?? null;
  try {
    return new URL(s.startsWith("http") ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// PROPERTY-TO-BUSINESS GRAPH (#2 lite from the brief)
//
// Given a focal lead + the rest of the user's leads, compute relationships:
//   - "shares phone with"
//   - "shares website domain with"
//   - "shares email domain with"
//   - "same SIRET" (if/when SIRET is available)
//   - "same brand name"
//   - "operates in same city"
//
// Pure analysis over existing data — no schema changes, no new external calls.
// The graph generates confidence scores rather than hard claims (per the brief).

export type RelationKind =
  | "shares_phone"
  | "shares_website_domain"
  | "shares_email_domain"
  | "same_siret"
  | "same_brand_name"
  | "same_city_segment"
  | "same_address";

export interface RelationEdge {
  to_lead_id: string;
  to_lead_name: string;
  to_city?: string | null;
  to_score?: number | null;
  kind: RelationKind;
  label: string; // human-readable label, e.g. "likely managed by"
  confidence: "high" | "medium" | "low";
  evidence: string;
}

export interface GraphLead {
  id: string;
  primary_name?: string | null;
  company_name?: string | null;
  city?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website_url?: string | null;
  score?: number | null;
  lead_type?: string | null;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function extractDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    return parts.slice(-2).join(".");
  } catch {
    return null;
  }
}

function extractEmailDomain(email?: string | null): string | null {
  if (!email) return null;
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) return null;
  const d = parts[1].trim();
  const FREE = new Set([
    "gmail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr",
    "outlook.com", "outlook.fr", "live.com", "live.fr", "orange.fr",
    "free.fr", "wanadoo.fr", "laposte.net", "sfr.fr", "icloud.com",
    "me.com", "aol.com", "neuf.fr",
  ]);
  return FREE.has(d) ? null : d;
}

function normalizeBrand(name?: string | null): string | null {
  if (!name) return null;
  const n = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(sarl|sas|sasu|eurl|sa|sci|snc|gie|société|societe|conciergerie|company|inc|ltd|llc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (n.length < 5) return null;
  const GENERIC = new Set([
    "airbnb", "booking", "vrbo", "abritel", "expedia",
    "hotel", "appartement", "location", "logement",
    "concierge", "agence", "office de tourisme",
  ]);
  if (GENERIC.has(n)) return null;
  return n;
}

export function computeRelations(focal: GraphLead, peers: GraphLead[]): RelationEdge[] {
  if (!focal.id) return [];

  const edges: RelationEdge[] = [];
  const seenEdgeKeys = new Set<string>();

  const focalPhoneKey = focal.phone ? digitsOnly(focal.phone) : null;
  const focalWebDomain = extractDomain(focal.website_url);
  const focalEmailDomain = extractEmailDomain(focal.email);
  const focalBrand = normalizeBrand(focal.company_name) ?? normalizeBrand(focal.primary_name);
  const focalAddrKey = focal.address?.toLowerCase().split(",")[0]?.trim() ?? null;

  function pushEdge(e: RelationEdge): void {
    const key = `${e.to_lead_id}:${e.kind}`;
    if (seenEdgeKeys.has(key)) return;
    seenEdgeKeys.add(key);
    edges.push(e);
  }

  for (const peer of peers) {
    if (peer.id === focal.id) continue;

    // shares phone — high confidence
    if (focalPhoneKey && peer.phone) {
      const peerKey = digitsOnly(peer.phone);
      if (peerKey === focalPhoneKey && peerKey.length >= 9) {
        pushEdge({
          to_lead_id: peer.id,
          to_lead_name: peer.primary_name ?? "(unnamed)",
          to_city: peer.city,
          to_score: peer.score,
          kind: "shares_phone",
          label: "shares phone number with",
          confidence: "high",
          evidence: `Both leads list ${focal.phone}`,
        });
      }
    }

    // shares website domain
    if (focalWebDomain && peer.website_url) {
      const pd = extractDomain(peer.website_url);
      if (pd && pd === focalWebDomain) {
        pushEdge({
          to_lead_id: peer.id,
          to_lead_name: peer.primary_name ?? "(unnamed)",
          to_city: peer.city,
          to_score: peer.score,
          kind: "shares_website_domain",
          label: "shares domain with",
          confidence: "medium",
          evidence: `Both linked to ${focalWebDomain}`,
        });
      }
    }

    // shares email domain (non-free)
    if (focalEmailDomain && peer.email) {
      const pd = extractEmailDomain(peer.email);
      if (pd && pd === focalEmailDomain) {
        pushEdge({
          to_lead_id: peer.id,
          to_lead_name: peer.primary_name ?? "(unnamed)",
          to_city: peer.city,
          to_score: peer.score,
          kind: "shares_email_domain",
          label: "shares email domain with",
          confidence: "medium",
          evidence: `Both email addresses on @${focalEmailDomain}`,
        });
      }
    }

    // same normalized brand name
    if (focalBrand) {
      const pb = normalizeBrand(peer.company_name) ?? normalizeBrand(peer.primary_name);
      if (pb && pb === focalBrand) {
        pushEdge({
          to_lead_id: peer.id,
          to_lead_name: peer.primary_name ?? "(unnamed)",
          to_city: peer.city,
          to_score: peer.score,
          kind: "same_brand_name",
          label: "same brand as",
          confidence: "low",
          evidence: `Normalised brand match: "${focalBrand}"`,
        });
      }
    }

    // same address
    if (focalAddrKey && peer.address) {
      const pa = peer.address.toLowerCase().split(",")[0]?.trim() ?? null;
      if (pa && pa === focalAddrKey) {
        pushEdge({
          to_lead_id: peer.id,
          to_lead_name: peer.primary_name ?? "(unnamed)",
          to_city: peer.city,
          to_score: peer.score,
          kind: "same_address",
          label: "same public address as",
          confidence: "high",
          evidence: `Both at "${focal.address}"`,
        });
      }
    }
  }

  // Confidence ordering: high → medium → low
  const order = { high: 3, medium: 2, low: 1 } as const;
  edges.sort((a, b) => order[b.confidence] - order[a.confidence]);
  return edges;
}

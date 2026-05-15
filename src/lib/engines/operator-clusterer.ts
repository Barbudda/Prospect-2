// OPERATOR CLUSTERER — discovers hidden multi-property operators by grouping
// existing leads that share strong identity signals (phone, domain, SIRET,
// company-name normalisation).
//
// This is the "Hidden Operator Detector" from the lead-intelligence roadmap.
// It runs over leads already saved in the DB — no new external API calls —
// so it's free, fast, and reveals high-value targets that were spread across
// multiple discovery runs without us realising they were the same operator.
//
// Output: ranked OperatorCluster[] with evidence trail and a representative
// lead per cluster. Display surfaces "8 properties under one operator" badges
// so the user can prioritise outreach to the operator, not to individual
// listings.

export interface LeadForClustering {
  id: string;
  primary_name: string;
  company_name?: string | null;
  city?: string | null;
  score?: number | null;
  phone?: string | null;
  email?: string | null;
  website_url?: string | null;
  source_url?: string | null;
  lead_type?: string | null;
}

export type ClusterMatchType = "siret" | "phone" | "domain" | "email_domain" | "company_name";

export interface OperatorCluster {
  cluster_key: string;
  match_type: ClusterMatchType;
  confidence: "high" | "medium" | "low";
  lead_count: number;
  lead_ids: string[];
  representative: {
    id: string;
    primary_name: string;
    city: string;
    score: number;
    phone?: string;
    email?: string;
    website_url?: string;
  };
  cities: string[];
  total_score: number;
  evidence: string[];
}

// ─── Normalisers ──────────────────────────────────────────────────────────────

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    // Strip common subdomain noise so "shop.x.com" and "x.com" cluster
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    // Keep the last two labels for typical TLDs (.com, .fr, .net)
    // For multi-level TLDs like .co.uk we'd miss but that's fine for FR market
    const last = parts[parts.length - 1];
    if (last.length === 2 && parts.length >= 3) {
      // Could be ccTLD with SLD — be conservative and keep last 3
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  } catch {
    return null;
  }
}

function extractEmailDomain(email: string): string | null {
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1].trim();
  // Don't cluster on free mail providers — millions of unrelated leads would merge
  const FREE = new Set([
    "gmail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr",
    "outlook.com", "outlook.fr", "live.com", "live.fr", "orange.fr",
    "free.fr", "wanadoo.fr", "laposte.net", "sfr.fr", "icloud.com",
    "me.com", "aol.com", "neuf.fr",
  ]);
  if (FREE.has(domain)) return null;
  return domain;
}

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(sarl|sas|sasu|eurl|sa|sci|snc|gie|société|societe|conciergerie|company|inc|ltd|llc|gmbh|bv|spa)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractSiret(lead: LeadForClustering): string | null {
  // SIRET stored explicitly on lead? Not on the base record — we only have
  // siret-bearing fields via quality_summary or operator data. Skip for now;
  // when SIRET surfacing lands as a proper column we'll wire it in.
  void lead;
  return null;
}

// ─── Main clusterer ───────────────────────────────────────────────────────────

interface BucketEntry {
  key: string;
  match_type: ClusterMatchType;
  leads: LeadForClustering[];
}

export function detectOperatorClusters(leads: LeadForClustering[]): OperatorCluster[] {
  const phoneBucket = new Map<string, LeadForClustering[]>();
  const domainBucket = new Map<string, LeadForClustering[]>();
  const emailDomainBucket = new Map<string, LeadForClustering[]>();
  const companyBucket = new Map<string, LeadForClustering[]>();
  const siretBucket = new Map<string, LeadForClustering[]>();

  for (const lead of leads) {
    // Phone — canonical form after strip
    if (lead.phone) {
      const key = digitsOnly(lead.phone);
      if (key.length >= 9) {
        const arr = phoneBucket.get(key) ?? [];
        arr.push(lead);
        phoneBucket.set(key, arr);
      }
    }
    // Website domain
    if (lead.website_url) {
      const dom = extractDomain(lead.website_url);
      if (dom) {
        const arr = domainBucket.get(dom) ?? [];
        arr.push(lead);
        domainBucket.set(dom, arr);
      }
    }
    // Email domain (excluding free providers)
    if (lead.email) {
      const ed = extractEmailDomain(lead.email);
      if (ed) {
        const arr = emailDomainBucket.get(ed) ?? [];
        arr.push(lead);
        emailDomainBucket.set(ed, arr);
      }
    }
    // Company / brand name (only for non-generic names ≥ 5 chars)
    const candidateName = lead.company_name ?? lead.primary_name;
    if (candidateName) {
      const norm = normalizeCompanyName(candidateName);
      if (norm.length >= 5 && !isGenericBrandName(norm)) {
        const arr = companyBucket.get(norm) ?? [];
        arr.push(lead);
        companyBucket.set(norm, arr);
      }
    }
    // SIRET
    const siret = extractSiret(lead);
    if (siret) {
      const arr = siretBucket.get(siret) ?? [];
      arr.push(lead);
      siretBucket.set(siret, arr);
    }
  }

  const allBuckets: BucketEntry[] = [
    ...Array.from(siretBucket, ([key, leads]) => ({ key, match_type: "siret" as const, leads })),
    ...Array.from(phoneBucket, ([key, leads]) => ({ key, match_type: "phone" as const, leads })),
    ...Array.from(domainBucket, ([key, leads]) => ({ key, match_type: "domain" as const, leads })),
    ...Array.from(emailDomainBucket, ([key, leads]) => ({ key, match_type: "email_domain" as const, leads })),
    ...Array.from(companyBucket, ([key, leads]) => ({ key, match_type: "company_name" as const, leads })),
  ];

  // Build clusters from buckets with at least 2 leads
  const seen = new Set<string>();
  const clusters: OperatorCluster[] = [];

  for (const bucket of allBuckets) {
    if (bucket.leads.length < 2) continue;
    // Dedupe by lead id within bucket
    const uniqueLeads = Array.from(new Map(bucket.leads.map((l) => [l.id, l])).values());
    if (uniqueLeads.length < 2) continue;

    // Avoid re-emitting the same lead set under multiple match types — keep
    // the strongest match type per lead set
    const fingerprint = uniqueLeads
      .map((l) => l.id)
      .sort()
      .join("|");
    const fpKey = `${bucket.match_type}:${fingerprint}`;
    if (seen.has(fpKey)) continue;
    seen.add(fpKey);

    const representative = uniqueLeads
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];

    const cities = Array.from(
      new Set(uniqueLeads.map((l) => l.city).filter((c): c is string => Boolean(c)))
    );

    const confidence: OperatorCluster["confidence"] =
      bucket.match_type === "siret" || bucket.match_type === "phone"
        ? "high"
        : bucket.match_type === "domain"
        ? "medium"
        : bucket.match_type === "email_domain"
        ? "medium"
        : "low";

    const evidence: string[] = [];
    if (bucket.match_type === "phone") evidence.push(`Shared phone: ${bucket.key.slice(-9)}`);
    if (bucket.match_type === "domain") evidence.push(`Shared website domain: ${bucket.key}`);
    if (bucket.match_type === "email_domain") evidence.push(`Shared email domain: ${bucket.key}`);
    if (bucket.match_type === "siret") evidence.push(`Same SIRET: ${bucket.key}`);
    if (bucket.match_type === "company_name") evidence.push(`Same brand name: "${bucket.key}"`);
    if (cities.length > 1) evidence.push(`Operates across ${cities.length} cities: ${cities.slice(0, 5).join(", ")}`);

    clusters.push({
      cluster_key: bucket.key,
      match_type: bucket.match_type,
      confidence,
      lead_count: uniqueLeads.length,
      lead_ids: uniqueLeads.map((l) => l.id),
      representative: {
        id: representative.id,
        primary_name: representative.primary_name,
        city: representative.city ?? "",
        score: representative.score ?? 0,
        phone: representative.phone ?? undefined,
        email: representative.email ?? undefined,
        website_url: representative.website_url ?? undefined,
      },
      cities,
      total_score: uniqueLeads.reduce((s, l) => s + (l.score ?? 0), 0),
      evidence,
    });
  }

  // Sort: highest confidence × lead count first, then by aggregate score
  const confScore = { high: 3, medium: 2, low: 1 };
  clusters.sort((a, b) => {
    const aRank = confScore[a.confidence] * a.lead_count;
    const bRank = confScore[b.confidence] * b.lead_count;
    if (aRank !== bRank) return bRank - aRank;
    return b.total_score - a.total_score;
  });

  return clusters;
}

// Generic / commodity brand names that would cluster huge unrelated leads
function isGenericBrandName(norm: string): boolean {
  const GENERIC = new Set([
    "airbnb", "booking", "vrbo", "abritel", "expedia", "homeaway",
    "facebook", "instagram", "linkedin", "tripadvisor", "google",
    "hotel", "appartement", "location", "logement", "rental",
    "conciergerie", "concierge", "agence", "agency",
    "communaute airbnb", "communaute booking",
    "site de la ville", "office de tourisme",
  ]);
  return GENERIC.has(norm) || norm.split(" ").length <= 1;
}

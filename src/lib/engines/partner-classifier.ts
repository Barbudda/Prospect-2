// PARTNER NETWORK CLASSIFIER (#7 lite from the brief)
//
// The full Partner Network Mapper would ingest external supplier directories
// (photographers, cleaners, smart-lock installers, etc.). This lite version
// classifies LEADS WE ALREADY HAVE as either:
//   - target_customer  → an STR operator we'd sell services to
//   - potential_partner → a supplier that serves STR operators (cleaning,
//                         photography, linen, smart-locks, interior design,
//                         legal/accounting, tourism office)
//
// Why: a "Reverse Concierge" play means partnering with these suppliers,
// who already have direct relationships with property owners. Surfacing
// them in our own lead list reveals partner opportunities for free.

export type PartnerRole =
  | "target_customer"
  | "cleaning"
  | "photography"
  | "linen"
  | "interior_design"
  | "smart_lock"
  | "pool_maintenance"
  | "real_estate_agent"
  | "concierge_company"
  | "tourism_office"
  | "legal_accounting"
  | "insurance"
  | "unknown";

export interface PartnerClassification {
  role: PartnerRole;
  is_partner: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface LeadForPartner {
  primary_name?: string | null;
  company_name?: string | null;
  lead_type?: string | null;
  quality_summary?: string | null;
}

interface Rule {
  role: PartnerRole;
  is_partner: boolean;
  patterns: RegExp[];
  confidence: "high" | "medium" | "low";
  hint: string;
}

const RULES: Rule[] = [
  {
    role: "cleaning",
    is_partner: true,
    confidence: "high",
    hint: "name mentions cleaning/ménage/clean",
    patterns: [
      /\b(nettoyage|m[ée]nage|cleaning|housekeeping)\b/i,
      /\bservice de propret[ée]\b/i,
    ],
  },
  {
    role: "photography",
    is_partner: true,
    confidence: "high",
    hint: "name mentions photo/photography/photographe",
    patterns: [/\b(photo(graphe)?|photography|shoot|studio photo)\b/i],
  },
  {
    role: "linen",
    is_partner: true,
    confidence: "medium",
    hint: "name mentions linen/blanchisserie/laundry",
    patterns: [/\b(blanchisserie|laundry|linge|linen|pressing)\b/i],
  },
  {
    role: "interior_design",
    is_partner: true,
    confidence: "medium",
    hint: "name mentions interior design/décoration/architecte d'intérieur",
    patterns: [
      /\b(interior\s+design|d[ée]coration|architecte d'int[ée]rieur|home staging)\b/i,
    ],
  },
  {
    role: "smart_lock",
    is_partner: true,
    confidence: "high",
    hint: "name mentions smart lock/serrurerie connectée/keynest",
    patterns: [/\b(smart.?lock|serrure connect[ée]e|keynest|keycafe|key.exchange)\b/i],
  },
  {
    role: "pool_maintenance",
    is_partner: true,
    confidence: "high",
    hint: "name mentions pool maintenance/piscine",
    patterns: [/\b(piscine|pool service|pool maintenance|piscinier)\b/i],
  },
  {
    role: "real_estate_agent",
    is_partner: true,
    confidence: "medium",
    hint: "lead_type or name implies real estate agency",
    patterns: [
      /\b(agence immobili[èe]re|immobilier|real estate agency|notaire|chasseur d'appart)\b/i,
    ],
  },
  {
    role: "tourism_office",
    is_partner: true,
    confidence: "high",
    hint: "name mentions office de tourisme",
    patterns: [/\b(office de tourisme|tourist board|tourisme officiel)\b/i],
  },
  {
    role: "legal_accounting",
    is_partner: true,
    confidence: "high",
    hint: "name mentions accountant/comptable/avocat",
    patterns: [/\b(comptable|cabinet comptable|expert.comptable|accountant|avocat|notaire)\b/i],
  },
  {
    role: "insurance",
    is_partner: true,
    confidence: "high",
    hint: "name mentions insurance/assurance",
    patterns: [/\b(assurance|insurance|broker assurance)\b/i],
  },
  {
    role: "concierge_company",
    is_partner: false, // these are SOMETIMES partners, sometimes competitors — flag separately
    confidence: "medium",
    hint: "lead_type or name is concierge — may compete OR refer",
    patterns: [/\b(concierge(rie)?|property manag(er|ement)|host(?:n|ing)|cohote)\b/i],
  },
];

export function classifyLeadAsPartner(lead: LeadForPartner): PartnerClassification {
  const haystack = [lead.primary_name, lead.company_name, lead.lead_type, lead.quality_summary]
    .filter(Boolean)
    .join(" ");

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) {
      return {
        role: rule.role,
        is_partner: rule.is_partner,
        confidence: rule.confidence,
        reasoning: rule.hint,
      };
    }
  }

  // Default: a typical STR operator → target customer
  return {
    role: "target_customer",
    is_partner: false,
    confidence: "medium",
    reasoning: "Pattern matches an STR operator (host/agency/manager), not a supplier.",
  };
}

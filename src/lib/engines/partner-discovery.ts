// PARTNER DISCOVERY (#7 advanced — active discovery, not just classification)
//
// Actively scans Google Places for suppliers around a city (cleaners,
// photographers, smart-lock installers, interior designers, etc.) and saves
// them as partner-tagged leads. Different from partner-classifier.ts which
// labels EXISTING leads — this finds NEW ones to partner with.

import type { NormalizedLead, LeadType } from "@/lib/types";
import { GooglePlacesProvider } from "@/lib/providers/google-places";
import { scoreLead } from "@/lib/engines/scorer";
import { generateOutreachAngle } from "@/lib/engines/outreach";
import { validatePhone } from "@/lib/utils/contact-validator";

const PARTNER_QUERIES: Array<{ role: string; queries: string[]; lead_type: LeadType }> = [
  { role: "cleaning", queries: ["nettoyage location vacances", "société de ménage", "cleaning service vacation rental"], lead_type: "Property Manager" },
  { role: "photography", queries: ["photographe immobilier", "photographe location vacances"], lead_type: "Property Manager" },
  { role: "interior_design", queries: ["architecte d'intérieur", "home staging", "décoration intérieur"], lead_type: "Property Manager" },
  { role: "smart_lock", queries: ["serrure connectée installation", "smart lock installer", "keycafe"], lead_type: "Property Manager" },
  { role: "linen", queries: ["blanchisserie professionnelle", "linge location vacances"], lead_type: "Property Manager" },
  { role: "pool_maintenance", queries: ["piscinier", "entretien piscine"], lead_type: "Property Manager" },
  { role: "real_estate_agent", queries: ["agence immobilière location saisonnière"], lead_type: "Vacation Rental Agency" },
  { role: "legal_accounting", queries: ["expert comptable LMNP", "comptable location meublée"], lead_type: "Property Manager" },
];

export interface PartnerDiscoveryOptions {
  city: string;
  country?: string;
  roles?: string[];
  max_per_role?: number;
}

export interface PartnerDiscoveryResult {
  leads: NormalizedLead[];
  by_role: Record<string, number>;
  queries_executed: number;
}

export async function discoverPartners(opts: PartnerDiscoveryOptions): Promise<PartnerDiscoveryResult> {
  const { city, country = "France", roles, max_per_role = 5 } = opts;

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return { leads: [], by_role: {}, queries_executed: 0 };
  }

  const targetRoles = roles && roles.length > 0
    ? PARTNER_QUERIES.filter((r) => roles.includes(r.role))
    : PARTNER_QUERIES;

  const places = new GooglePlacesProvider();
  const seenPlaceIds = new Set<string>();
  const out: NormalizedLead[] = [];
  const byRole: Record<string, number> = {};
  let queriesExecuted = 0;

  for (const role of targetRoles) {
    byRole[role.role] = 0;
    for (const q of role.queries) {
      try {
        queriesExecuted++;
        const results = await places.searchBusinesses(q, city, country, max_per_role * 2);
        for (const r of results) {
          const payload = r.raw_provider_payload as { place_id?: string } | undefined;
          const placeId = payload?.place_id ?? r.source_url ?? r.business_name;
          if (!placeId || seenPlaceIds.has(placeId)) continue;
          seenPlaceIds.add(placeId);

          const cleanPhone = r.phone ? validatePhone(r.phone, "FR") : null;
          const phone = cleanPhone?.valid ? cleanPhone.e164 : undefined;

          if (!phone && !r.website) continue; // unreachable partner — skip

          const summary = [
            `Partner candidate (${role.role.replace(/_/g, " ")}) found via Google Maps in ${city}.`,
            r.rating ? `Rating: ${r.rating} (${r.review_count ?? 0} reviews).` : null,
            phone ? "Phone verified on Google Business Profile." : null,
            "Approach as PARTNER, not customer.",
          ].filter(Boolean).join(" ");

          const partial: Partial<NormalizedLead> = {
            primary_name: r.business_name,
            company_name: r.business_name,
            lead_type: role.lead_type,
            city,
            country,
            address: r.address,
            website_url: r.website,
            phone,
            source_url: r.google_maps_url ?? "",
            source_type: `partner_discovery:${role.role}`,
            google_maps_url: r.google_maps_url,
            quality_summary: summary,
            confidence: phone && r.website ? "high" : "medium",
            status: "new",
            outreach_status: "not_contacted",
            exclusivity_score: 60, // partners aren't exclusivity targets but ARE referral value
          };
          const { score, label } = scoreLead(partial);

          out.push({
            ...partial,
            score,
            score_label: label,
            suggested_angle: generateOutreachAngle(role.lead_type),
            source_url: r.google_maps_url ?? "",
          } as NormalizedLead);

          byRole[role.role]++;
          if (byRole[role.role] >= max_per_role) break;
        }
      } catch (err) {
        console.error(`[partner-discovery] ${role.role} "${q}" failed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return { leads: out, by_role: byRole, queries_executed: queriesExecuted };
}

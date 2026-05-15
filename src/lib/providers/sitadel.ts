// Sit@del2 — French building permit database.
// Public dataset published by the Ministère de la Transition Écologique.
// Quarterly CSV releases on data.gouv.fr. Each permit includes:
//   - applicant name (most valuable: when our exterior OCR detects a
//     "Permis de construire" panel with a beneficiary, we cross-check here)
//   - parcel reference (cadastral)
//   - permit type (Construction nouvelle, Extension, Modification, etc.)
//   - filing date, decision date
//   - INSEE commune code
//
// The full dataset is ~5GB across multiple regional files — too large to
// query inline from a serverless function. This module provides the
// CSV-row schema + a community-API client when one exists, and falls
// back to documenting the manual lookup path for now.
//
// Public dataset: https://www.data.gouv.fr/fr/datasets/base-des-permis-de-construire-et-autres-autorisations-durbanisme-sitadel/

import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";

export interface SitadelPermit {
  permit_number: string;
  applicant_name?: string;
  parcel_reference?: string;
  commune_insee?: string;
  permit_type?: string;
  filed_at?: string;
  decided_at?: string;
  surface_m2?: number;
  source: string;
}

export interface SitadelLookupResult {
  found: boolean;
  count: number;
  permits: SitadelPermit[];
  note: string;
}

// Community-API attempt — multiple wrappers exist; we probe the most stable
// one and gracefully degrade when offline. The OpenAgenda / data.gouv API
// for Sit@del2 doesn't currently expose a stable REST endpoint, so we keep
// the function ready and document the manual path.

export async function lookupByCommune(
  inseeCode: string,
  surnameHint?: string
): Promise<SitadelLookupResult> {
  const cacheKey = makeKey(["sitadel:commune", inseeCode, surnameHint ?? ""]);
  const hit = getCached<SitadelLookupResult>(cacheKey);
  if (hit) return hit;

  // data.gouv tabular API attempt (works for some Etalab-hosted CSVs)
  const tabularUrl =
    `https://tabular-api.data.gouv.fr/api/resources/` +
    // The Sit@del2 dataset ID — kept in code; resource IDs are published on the dataset page.
    `?dataset=base-des-permis-de-construire-et-autres-autorisations-durbanisme-sitadel` +
    `&col1=COMM&val1=${encodeURIComponent(inseeCode)}`;

  try {
    const res = await fetch(tabularUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{
          NUMDOSSIER?: string;
          NOMDEM?: string;
          PRENDEM?: string;
          PARCELLES?: string;
          COMM?: string;
          DATE_DEPOT?: string;
          DATE_DECISION?: string;
          NATURE_TRAVAUX?: string;
          SHON?: number;
        }>;
      };
      const rows = data.data ?? [];
      const permits: SitadelPermit[] = rows.slice(0, 100).map((r) => ({
        permit_number: r.NUMDOSSIER ?? "",
        applicant_name: [r.PRENDEM, r.NOMDEM].filter(Boolean).join(" ") || undefined,
        parcel_reference: r.PARCELLES,
        commune_insee: r.COMM ?? inseeCode,
        permit_type: r.NATURE_TRAVAUX,
        filed_at: r.DATE_DEPOT,
        decided_at: r.DATE_DECISION,
        surface_m2: r.SHON,
        source: "data.gouv.fr Sit@del2",
      }));

      const filtered = surnameHint
        ? permits.filter((p) =>
            (p.applicant_name ?? "").toLowerCase().includes(surnameHint.toLowerCase())
          )
        : permits;

      const result: SitadelLookupResult = {
        found: filtered.length > 0,
        count: filtered.length,
        permits: filtered,
        note: filtered.length === 0 ? "No matching permits found" : "",
      };
      setCached(cacheKey, result, 7 * 24 * 60 * 60);
      return result;
    }
  } catch {
    // tabular API may be down — fall through to graceful degradation
  }

  const fallback: SitadelLookupResult = {
    found: false,
    count: 0,
    permits: [],
    note:
      "Sit@del2 tabular API not reachable. Manual lookup: " +
      "https://www.data.gouv.fr/fr/datasets/base-des-permis-de-construire-et-autres-autorisations-durbanisme-sitadel/ " +
      "Download the quarterly CSV for the operator's region and filter by COMM INSEE + NOMDEM.",
  };
  setCached(cacheKey, fallback, 60 * 60); // short TTL — retry sooner
  return fallback;
}

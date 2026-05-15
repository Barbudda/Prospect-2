// DVF — Demandes de Valeurs Foncières
// Open French dataset of every real-estate transaction since 2014.
// Free, public, no key. Available via cquest.org / Etalab community API.
//
// Useful for the visual-reconstruction chain: once IGN Cadastre identifies a
// parcel at the property's GPS coordinates, DVF tells us:
//   - When the parcel last changed hands (date_mutation)
//   - Sale price (valeur_fonciere) — proxy for property tier
//   - Surface area, room count
//   - Type (Appartement / Maison / Local)
//
// The public DVF release does NOT include personal names of buyers/sellers
// (Etalab strips them for privacy). This provider returns transaction
// metadata only — useful for prioritisation, not for owner identification.

import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";

export interface DVFTransaction {
  date: string;
  nature: string;             // "Vente", "Vente en l'état futur d'achèvement", etc.
  price_eur?: number;
  address?: string;
  postal_code?: string;
  commune?: string;
  parcel_id?: string;
  property_type?: string;     // "Appartement" | "Maison" | "Local industriel/commercial"
  surface_m2?: number;
  rooms?: number;
}

export interface DVFLookupResult {
  found: boolean;
  count: number;
  transactions: DVFTransaction[];
  last_transaction?: DVFTransaction;
  source_url: string;
}

const BASE = "https://api.cquest.org/dvf";

// Lookup by GPS (most useful when we have parcel coords from IGN Cadastre)
export async function lookupByCoords(
  lat: number,
  lon: number,
  radiusMeters = 30
): Promise<DVFLookupResult> {
  const cacheKey = makeKey(["dvf:coords", lat.toFixed(5), lon.toFixed(5), radiusMeters]);
  const hit = getCached<DVFLookupResult>(cacheKey);
  if (hit) return hit;

  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    dist: String(radiusMeters),
  });
  const url = `${BASE}?${params}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const empty: DVFLookupResult = {
        found: false,
        count: 0,
        transactions: [],
        source_url: url,
      };
      return empty;
    }
    const data = (await res.json()) as {
      features?: Array<{
        properties?: {
          date_mutation?: string;
          nature_mutation?: string;
          valeur_fonciere?: number;
          l3_normalisee?: string;
          code_postal?: string;
          nom_commune?: string;
          id_parcelle?: string;
          type_local?: string;
          surface_reelle_bati?: number;
          nombre_pieces_principales?: number;
        };
      }>;
    };

    const transactions: DVFTransaction[] = (data.features ?? [])
      .map((f) => f.properties)
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        date: p.date_mutation ?? "",
        nature: p.nature_mutation ?? "",
        price_eur: typeof p.valeur_fonciere === "number" ? Math.round(p.valeur_fonciere) : undefined,
        address: p.l3_normalisee,
        postal_code: p.code_postal,
        commune: p.nom_commune,
        parcel_id: p.id_parcelle,
        property_type: p.type_local,
        surface_m2: p.surface_reelle_bati,
        rooms: p.nombre_pieces_principales,
      }))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    const result: DVFLookupResult = {
      found: transactions.length > 0,
      count: transactions.length,
      transactions: transactions.slice(0, 20),
      last_transaction: transactions[0],
      source_url: url,
    };
    setCached(cacheKey, result, 30 * 24 * 60 * 60); // 30 days
    return result;
  } catch (err) {
    console.error("[DVF] lookup failed:", err instanceof Error ? err.message : err);
    return { found: false, count: 0, transactions: [], source_url: url };
  }
}

// IGN / Cadastre API — French parcel (cadastral) data from apicarto.ign.fr
// Public API, no authentication required.
// Returns parcel polygon and reference for a given lat/lng coordinate.
// Raw data only — Mammouth validates spatial consistency.

import type { CadastralParcel } from "@/lib/types";

const CADASTRE_BASE = "https://apicarto.ign.fr/api/cadastre";

export interface RawParcelFeature {
  type: string;
  geometry?: {
    type: string;
    coordinates?: unknown;
  };
  properties?: {
    id?: string;
    prefixe?: string;
    section?: string;
    numero?: string;
    contenance?: number; // area in m²
    code_dep?: string;
    code_com?: string;
    com_abs?: string;
    feuille?: number;
    idu?: string; // identifiant unique de parcelle
  };
}

export async function getParcelByCoords(
  latitude: number,
  longitude: number
): Promise<CadastralParcel | null> {
  const params = new URLSearchParams({
    lon: String(longitude),
    lat: String(latitude),
    _limit: "3",
  });

  const res = await fetch(`${CADASTRE_BASE}/parcelle?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`IGN Cadastre HTTP ${res.status}`);
  }

  const data = await res.json() as {
    features?: RawParcelFeature[];
    numberMatched?: number;
  };

  const feature = data.features?.[0];
  if (!feature?.properties) return null;

  const p = feature.properties;
  const section = p.section ?? "";
  const numero = p.numero ?? "";
  const codeDep = p.code_dep ?? "";
  const codeCom = p.code_com ?? "";

  return {
    parcel_id: p.idu ?? p.id ?? `${codeDep}${codeCom}${section}${numero}`,
    cadastral_reference: `${codeDep}${codeCom}${section}${numero}`,
    commune: `${codeDep}${codeCom}`,
    section,
    numero,
    area_m2: p.contenance ?? undefined,
    coordinates: { longitude, latitude },
  };
}

// Reverse geocode to get commune/address using BAN (Base Adresse Nationale)
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<{ label: string; street?: string; postcode?: string; city?: string } | null> {
  const params = new URLSearchParams({
    lon: String(longitude),
    lat: String(latitude),
    limit: "1",
  });

  const res = await fetch(`https://api-adresse.data.gouv.fr/reverse/?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) return null;

  const data = await res.json() as {
    features?: Array<{
      properties?: {
        label?: string;
        street?: string;
        postcode?: string;
        city?: string;
      };
    }>;
  };

  const props = data.features?.[0]?.properties;
  if (!props) return null;

  return {
    label: props.label ?? "",
    street: props.street,
    postcode: props.postcode,
    city: props.city,
  };
}

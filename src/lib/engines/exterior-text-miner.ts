// EXTERIOR TEXT MINING — extracts owner identity signals from the OCR text
// captured by Google Vision on listing exterior photos.
//
// Recovers signals that the current pipeline throws away:
//   - Surnames on mailboxes, doorbells, intercom panels
//   - Property name plaques ("Villa Les Hortensias", "Mas du Soleil")
//   - Phone numbers on direct signage
//   - Adjacent business signs (boulangerie next door = often holds the keys)
//   - Construction permit panels (legally required to display owner's full name)
//   - Tourism classification plaques (Atout France, Gîtes de France, Clévacances)
//
// These signals feed back into Phone Hunter to find the owner's contact info.

import * as Mammouth from "@/lib/providers/mammouth";
import type { VisionAnnotation } from "@/lib/providers/google-vision";

export interface PermitInfo {
  beneficiary_name?: string;
  permit_number?: string;
}

export interface TourismClassification {
  type: string; // "atout_france" | "gites_de_france" | "clevacances" | other
  reference?: string;
  stars_or_epis?: number;
}

export interface ExteriorSignals {
  surnames: string[];           // From mailboxes, doorbells, permit panels — UPPERCASE
  property_names: string[];     // Gate plaques ("Villa Les Hortensias")
  visible_phones: string[];     // Phone numbers directly visible on signage
  business_names: string[];     // Nearby commercial signs
  street_addresses: string[];   // Visible street signs / house numbers
  permit_info?: PermitInfo;     // From the yellow "Permis de construire" panel
  tourism_classification?: TourismClassification;
  raw_ocr_text: string;         // Aggregated OCR for debugging
}

const EMPTY: ExteriorSignals = {
  surnames: [],
  property_names: [],
  visible_phones: [],
  business_names: [],
  street_addresses: [],
  raw_ocr_text: "",
};

// Surnames must look like French family names — no all-digit, no obvious brand
function isPlausibleSurname(s: string): boolean {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 2 || t.length > 30) return false;
  if (!/^[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý'\-\s]+$/.test(t)) return false;
  // Reject common non-name uppercase words
  const BLACKLIST = new Set([
    "AIRBNB", "BOOKING", "HOTEL", "HÔTEL", "VILLA", "MAS", "STOP", "SORTIE",
    "ENTREE", "ENTRÉE", "PARKING", "PRIVE", "PRIVÉ", "PRIVATE", "PROPRIETE",
    "PROPRIÉTÉ", "VENTE", "LOUER", "VENDU", "OUVERT", "FERMÉ", "ATTENTION",
    "DANGER", "CHIEN", "WIFI", "FREE", "NIKE", "ADIDAS", "COCA", "PEPSI",
    "PARIS", "NICE", "LYON", "MARSEILLE", "BORDEAUX",
  ]);
  if (BLACKLIST.has(t.toUpperCase())) return false;
  return true;
}

function isPlausiblePropertyName(s: string): boolean {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 4 || t.length > 60) return false;
  // Must contain a typical property-name keyword OR look like a proper-noun phrase
  const KEYWORDS = /\b(villa|mas|chalet|domaine|gîte|gite|maison|résidence|residence|bastide|moulin|chateau|château|ferme|cabane|lodge|cottage)\b/i;
  if (!KEYWORDS.test(t)) {
    // Or accept "Le/La/Les XXX" composite names
    if (!/^(?:le|la|les|l')\s+\w+/i.test(t)) return false;
  }
  return true;
}

export async function mineExteriorSignals(
  annotations: VisionAnnotation[]
): Promise<ExteriorSignals> {
  const ocrText = annotations
    .map((a) => a.ocr_text)
    .filter(Boolean)
    .join("\n---\n")
    .slice(0, 3000);

  if (!ocrText.trim()) return EMPTY;
  if (!Mammouth.isConfigured()) return { ...EMPTY, raw_ocr_text: ocrText };

  try {
    const classified = await Mammouth.reason<{
      surnames?: string[];
      property_names?: string[];
      visible_phones?: string[];
      business_names?: string[];
      street_addresses?: string[];
      permit_info?: PermitInfo | null;
      tourism_classification?: TourismClassification | null;
    }>(
      "You extract owner-identity signals from OCR captured from exterior photos of a French property listing.",
      `OCR text captured by Google Vision from the EXTERIOR photos and environment:
\`\`\`
${ocrText}
\`\`\`

Classify the captured text into these categories. Return JSON only.

1. surnames — French family names plausibly visible on mailboxes (BAL), doorbells (sonnette), intercom panels, or construction permit panels. Examples: "MARTIN", "DUPONT", "GARCIA". Return in UPPERCASE. Skip first names alone.
2. property_names — gate/wall plaques naming the property. Examples: "Villa Les Hortensias", "Mas du Soleil", "Le Petit Domaine", "Chalet Edelweiss".
3. visible_phones — French phone numbers visible on signs (10 digits 0X XX XX XX XX or +33 X XX XX XX XX).
4. business_names — nearby commercial signs ("Boulangerie Dupont", "Le Petit Café", "Agence Foncia Biarritz").
5. street_addresses — visible street signs and house numbers ("12 Rue Victor Hugo", "Avenue des Pins 47").
6. permit_info — if a French "Permis de construire" yellow panel is detected with a beneficiary name and/or permit number, extract it. Set null if absent.
7. tourism_classification — if you see an Atout France star plaque, Gîtes de France épis, or Clévacances key plaque (with a reference number), extract type + reference + count. Set null if absent.

STRICTLY IGNORE: graffiti, brand logos, car license plates, advertising slogans, generic safety/parking words, commercial chain names, internet provider stickers.

JSON response shape:
{
  "surnames": [],
  "property_names": [],
  "visible_phones": [],
  "business_names": [],
  "street_addresses": [],
  "permit_info": null,
  "tourism_classification": null
}`
    );

    if (!classified) return { ...EMPTY, raw_ocr_text: ocrText };

    return {
      surnames: (classified.surnames ?? []).filter(isPlausibleSurname),
      property_names: (classified.property_names ?? []).filter(isPlausiblePropertyName),
      visible_phones: (classified.visible_phones ?? []).filter(
        (s) => typeof s === "string" && /\d/.test(s)
      ),
      business_names: (classified.business_names ?? []).filter(
        (s) => typeof s === "string" && s.length >= 3 && s.length <= 80
      ),
      street_addresses: (classified.street_addresses ?? []).filter(
        (s) => typeof s === "string" && s.length >= 3
      ),
      permit_info: classified.permit_info?.beneficiary_name
        ? classified.permit_info
        : undefined,
      tourism_classification: classified.tourism_classification?.type
        ? classified.tourism_classification
        : undefined,
      raw_ocr_text: ocrText,
    };
  } catch (err) {
    console.error("[ExteriorTextMiner]", err instanceof Error ? err.message : err);
    return { ...EMPTY, raw_ocr_text: ocrText };
  }
}

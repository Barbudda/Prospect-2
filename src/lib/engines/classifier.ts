import type { LeadType } from "@/lib/types";

const KEYWORD_MAP: Array<{ type: LeadType; keywords: string[] }> = [
  {
    type: "Airbnb Concierge",
    keywords: ["conciergerie", "concierge", "check-in", "check-out", "ménage", "nettoyage", "accueil voyageurs"],
  },
  {
    type: "Property Manager",
    keywords: ["property management", "property manager", "gestionnaire", "gestion locative", "gestionnaire de biens"],
  },
  {
    type: "Direct Booking Owner",
    keywords: ["réservation directe", "book direct", "propriétaire", "owner contact", "réservez directement"],
  },
  {
    type: "Vacation Rental Agency",
    keywords: ["agence", "agency", "saisonnière", "seasonal rental", "location saisonnière"],
  },
  {
    type: "Gîte / Villa Operator",
    keywords: ["gîte", "villa", "maison de vacances", "chalet", "cottage", "chambre d'hôtes"],
  },
  {
    type: "Co-host / Consultant",
    keywords: ["co-hôte", "cohost", "co-host", "superhôte", "superhost", "consultant airbnb"],
  },
  {
    type: "Real Estate Seasonal Rental",
    keywords: ["agence immobilière", "immobilier", "real estate", "gestion saisonnière"],
  },
];

export function classifyLead(
  text: string,
  category?: string
): LeadType {
  const lower = (text + " " + (category ?? "")).toLowerCase();

  for (const { type, keywords } of KEYWORD_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return type;
    }
  }

  return "Unknown STR Lead";
}

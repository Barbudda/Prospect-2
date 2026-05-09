import type { LeadType } from "@/lib/types";

const KEYWORD_MAP: Array<{ type: LeadType; keywords: string[] }> = [
  {
    type: "Individual Airbnb Host",
    keywords: [
      "airbnb.com/rooms", "airbnb.fr/rooms", "abritel.fr/location-vacances",
      "superhôte", "superhost", "hôte airbnb", "hôte particulier",
      "airbnb host", "individual host", "particulier airbnb",
    ],
  },
  {
    type: "Airbnb Concierge",
    keywords: [
      "conciergerie", "concierge", "check-in", "check-out",
      "ménage", "nettoyage", "accueil voyageurs", "accueil des voyageurs",
      "gestion airbnb", "gestion des clés", "remise des clés",
      "prestation airbnb", "service airbnb", "airbnb management",
      "gestion courte durée", "gestion locative courte durée",
      "under the key", "clé en main", "clés en main",
    ],
  },
  {
    type: "Property Manager",
    keywords: [
      "property management", "property manager", "gestionnaire",
      "gestion locative", "gestionnaire de biens",
      "gestion de biens", "gestion immobilière",
      "gestionnaire location", "gestion saisonnière",
      "gestion de patrimoine locatif", "mandataire",
    ],
  },
  {
    type: "Direct Booking Owner",
    keywords: [
      "réservation directe", "book direct", "propriétaire", "owner contact",
      "réservez directement", "réserver directement",
      "contact propriétaire", "louer en direct",
      "location directe", "sans intermédiaire",
    ],
  },
  {
    type: "Vacation Rental Agency",
    keywords: [
      "agence", "agency", "location saisonnière",
      "seasonal rental", "agence de location",
      "agence immobilière saisonnière",
      "agence location vacances", "agence tourisme",
      "agence location meublé", "location meublé tourisme",
    ],
  },
  {
    type: "Gîte / Villa Operator",
    keywords: [
      "gîte", "villa", "maison de vacances", "chalet", "cottage",
      "chambre d'hôtes", "chambre hôtes", "mas", "bastide",
      "manoir", "domaine", "fermette", "studio meublé",
      "location vacances", "logement vacances",
    ],
  },
  {
    type: "Co-host / Consultant",
    keywords: [
      "co-hôte", "cohost", "co-host", "superhôte", "superhost",
      "consultant airbnb", "coach airbnb", "formation airbnb",
      "optimisation airbnb", "optimisation annonce",
      "stratégie location saisonnière",
    ],
  },
  {
    type: "Real Estate Seasonal Rental",
    keywords: [
      "agence immobilière", "immobilier", "real estate",
      "gestion saisonnière", "cabinet immobilier",
      "transaction immobilière", "syndic", "promoteur",
      "location meublé", "bail meublé", "meublé de tourisme",
    ],
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

import Anthropic from "@anthropic-ai/sdk";

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured. Add it to your environment variables.");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// SSRF guard — reused from scripts pattern
function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const h = parsed.hostname.toLowerCase();
    if (h === "localhost" || h.startsWith("127.") || h === "0.0.0.0") return false;
    const parts = h.split(".").map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      const [a, b] = parts;
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
    }
    return true;
  } catch { return false; }
}

export async function fetchWebsiteContent(url: string): Promise<string | null> {
  if (!isPublicUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ProspectBot/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Strip tags, collapse whitespace, cap at 4000 chars
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    return text || null;
  } catch { return null; }
}

export interface LeadContext {
  primary_name: string;
  lead_type: string;
  city: string;
  country: string;
  website_url?: string | null;
  email?: string | null;
  phone?: string | null;
  suggested_angle?: string | null;
  quality_summary?: string | null;
  website_content?: string | null;
}

export async function generateOutreachEmail(lead: LeadContext): Promise<string> {
  const client = getClient();

  const websiteSection = lead.website_content
    ? `\n\nContenu du site web du prospect :\n"""\n${lead.website_content}\n"""`
    : "";

  const typeContext: Record<string, string> = {
    "Airbnb Concierge": "conciergerie Airbnb qui gère les check-in/check-out et le ménage pour plusieurs propriétaires",
    "Property Manager": "gestionnaire de biens qui administre un portefeuille de locations saisonnières",
    "Direct Booking Owner": "propriétaire qui fait de la réservation directe sur son propre site",
    "Vacation Rental Agency": "agence spécialisée en location saisonnière",
    "Gîte / Villa Operator": "opérateur de gîtes ou villas qui accueille des vacanciers",
    "Co-host / Consultant": "co-hôte ou consultant Airbnb qui accompagne des propriétaires",
    "Real Estate Seasonal Rental": "agence immobilière positionnée sur la location saisonnière",
    "Unknown STR Lead": "acteur du secteur location courte durée",
  };

  const typeDesc = typeContext[lead.lead_type] ?? typeContext["Unknown STR Lead"];

  const prompt = `Tu es chargé de la prospection commerciale pour une startup qui vend un assistant IA dédié à l'expérience voyageur pour les locations Airbnb et courtes durées. L'assistant répond automatiquement aux messages des voyageurs 24h/24, réduit les questions répétitives, et améliore les notes et avis.

Ton prospect est une ${typeDesc} basée à ${lead.city}${lead.country !== "France" ? `, ${lead.country}` : ""} : ${lead.primary_name}.
${lead.website_url ? `Site web : ${lead.website_url}` : ""}
${lead.suggested_angle ? `Angle commercial : ${lead.suggested_angle}` : ""}
${lead.quality_summary ? `Contexte : ${lead.quality_summary}` : ""}${websiteSection}

Écris un email de prospection en français avec ces contraintes strictes :
1. OBJET : commence par "Objet : " (une ligne accrocheuse, max 8 mots, spécifique à leur activité)
2. ACCROCHE : une phrase d'ouverture qui montre que tu connais leur activité spécifique (ne pas commencer par "Je" ni par "Bonjour")
3. PROBLÈME : une phrase sur la douleur concrète que tu résous pour ce type d'opérateur
4. SOLUTION : une phrase sur ce que l'assistant IA apporte spécifiquement (pas de marketing générique)
5. PREUVE / RÉSULTAT : chiffre ou bénéfice concret (ex: "réduire de 80% les questions répétitives", "améliorer la note Airbnb")
6. APPEL À L'ACTION : une question ouverte et naturelle pour lancer la conversation
7. PAS de signature
8. PAS de markdown
9. Texte brut, max 8 lignes au total
10. Ton : direct, professionnel, jamais vendeur ou générique — comme un message d'un fondateur à un pair`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

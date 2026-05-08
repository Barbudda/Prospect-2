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

  const prompt = `Tu es un expert en prospection B2B pour le secteur de la location saisonnière (Airbnb, gîtes, conciergeries).

Rédige un email de prospection court, personnalisé et professionnel en français pour ce prospect :

Nom / Entreprise : ${lead.primary_name}
Type : ${lead.lead_type}
Ville : ${lead.city}, ${lead.country}
Site web : ${lead.website_url ?? "non renseigné"}
${lead.suggested_angle ? `Angle de prospection suggéré : ${lead.suggested_angle}` : ""}
${lead.quality_summary ? `Résumé qualité : ${lead.quality_summary}` : ""}${websiteSection}

Règles :
- Longueur : 5 à 8 lignes maximum
- Objet d'email inclus au début (format "Objet : ...")
- Ton professionnel mais humain, pas de formules génériques
- Mentionner un détail spécifique au prospect (extrait du site ou de sa ville)
- Proposer une valeur claire (la solution que tu vends : assistant IA guest experience pour Airbnb)
- Terminer par une question ouverte pour engager la conversation
- PAS de signature (elle sera ajoutée séparément)
- PAS de balises markdown, texte brut uniquement`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text.trim();
}

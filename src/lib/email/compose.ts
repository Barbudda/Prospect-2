// EMAIL COMPOSER — Anthropic-backed drafting for the /mailing feature.
//
// Two modes:
//   - per_lead: one personalised draft per lead using its full context
//     (operator type, city, website signals, weird signals, dossier
//     summary). Higher conversion but slower + more tokens.
//   - general: one shared draft that uses general guidance about the
//     selected lead set (cities, dominant operator type). Faster + cheaper.
//
// The composer ALWAYS returns a strict JSON { subject, body } so the
// executor can wire it directly into Resend without parsing risk.
// Honest framing in the prompt: no fake stats, no claims we can't back
// up, polite cold-outbound tone with a clear out.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey: key });
}

export interface LeadForCompose {
  id: string;
  primary_name: string | null;
  person_name?: string | null;
  company_name?: string | null;
  lead_type?: string | null;
  city?: string | null;
  country?: string | null;
  website_url?: string | null;
  email?: string | null;
  phone?: string | null;
  quality_summary?: string | null;
  suggested_angle?: string | null;
  superhost?: boolean | null;
  review_count?: number | null;
  estimated_property_count?: number | null;
  has_booking_engine?: boolean | null;
  has_chatbot?: boolean | null;
  automation_level?: string | null;
}

export interface ComposeResult {
  subject: string;
  body: string;
  /** Optional reasoning surfaced to the chatbot UI. */
  notes?: string;
}

const SYSTEM_PROMPT = `You are an experienced B2B cold-outbound copywriter for an AI guest-assistant product targeting French short-term rental operators.

Strict rules:
- Write in the lead's language (default French if FR market).
- Never invent statistics, awards, or facts you cannot justify from the context provided.
- Be specific about the operator (city, property type, signals) so the email feels hand-written, not templated.
- Single, clear call-to-action. No more than one question.
- Length: 80-130 words for the body.
- No emojis, no exclamation marks, no "I hope this email finds you well".
- Include a respectful out: "if this isn't relevant, just reply STOP".
- The subject must be 4-9 words, lowercase except proper nouns, no clickbait.

Output format: a single JSON object with keys "subject" and "body". Body is plain text with newlines preserved. No markdown, no extra prose around the JSON.`;

function leadContextBlock(lead: LeadForCompose): string {
  const parts: string[] = [
    `id: ${lead.id}`,
    lead.primary_name ? `name: ${lead.primary_name}` : "",
    lead.person_name ? `person: ${lead.person_name}` : "",
    lead.company_name ? `company: ${lead.company_name}` : "",
    lead.lead_type ? `lead_type: ${lead.lead_type}` : "",
    lead.city ? `city: ${lead.city}` : "",
    lead.country ? `country: ${lead.country}` : "",
    lead.website_url ? `website: ${lead.website_url}` : "",
    lead.superhost ? `superhost: yes` : "",
    typeof lead.review_count === "number" ? `reviews: ${lead.review_count}` : "",
    typeof lead.estimated_property_count === "number"
      ? `estimated_properties: ${lead.estimated_property_count}`
      : "",
    lead.automation_level ? `automation_level: ${lead.automation_level}` : "",
    lead.has_booking_engine ? `has_booking_engine: yes` : "",
    lead.has_chatbot ? `has_chatbot: yes` : "",
    lead.suggested_angle ? `suggested_angle: ${lead.suggested_angle}` : "",
    lead.quality_summary ? `signals: ${lead.quality_summary.slice(0, 600)}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function parseJsonish(raw: string): { subject: string; body: string } | null {
  const trimmed = raw.trim();
  // Try fenced JSON first
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed?.subject === "string" && typeof parsed?.body === "string") {
      return { subject: parsed.subject.trim(), body: parsed.body.trim() };
    }
  } catch {
    /* fall through */
  }
  // Loose extraction: look for the first {...} block
  const m = trimmed.match(/\{[\s\S]*?\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (typeof parsed?.subject === "string" && typeof parsed?.body === "string") {
        return { subject: parsed.subject.trim(), body: parsed.body.trim() };
      }
    } catch {
      /* give up */
    }
  }
  return null;
}

export async function composePerLead(
  userInstruction: string,
  lead: LeadForCompose
): Promise<ComposeResult> {
  const client = getClient();
  const prompt = `User instruction for this campaign:
${userInstruction}

Lead context:
${leadContextBlock(lead)}

Write the email now. Return JSON only.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("\n");

  const parsed = parseJsonish(text);
  if (!parsed) {
    throw new Error("Composer returned non-JSON; please retry with a clearer instruction.");
  }
  return parsed;
}

export async function composeGeneralTemplate(
  userInstruction: string,
  leadSample: LeadForCompose[]
): Promise<ComposeResult> {
  const client = getClient();
  const cities = Array.from(
    new Set(leadSample.map((l) => l.city).filter(Boolean) as string[])
  ).slice(0, 8);
  const leadTypes = Array.from(
    new Set(leadSample.map((l) => l.lead_type).filter(Boolean) as string[])
  ).slice(0, 8);

  const prompt = `User instruction for this campaign:
${userInstruction}

You are writing ONE shared template that will be sent to ${leadSample.length} leads.

Audience summary:
cities (sample): ${cities.join(", ") || "various"}
lead_types: ${leadTypes.join(", ") || "various"}

Constraints for a shared template:
- Use the placeholder {{primary_name}} for the recipient name and {{city}} for their city.
- Keep specifics minimal — anything you cannot guarantee for every lead in the set must be left out or templated.
- Same length + tone rules as before.

Return JSON only.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("\n");

  const parsed = parseJsonish(text);
  if (!parsed) {
    throw new Error("Composer returned non-JSON; please retry with a clearer instruction.");
  }
  return parsed;
}

// Substitutes {{primary_name}} / {{city}} / {{company_name}} / {{lead_type}}
// placeholders against a lead. Anything unresolved is replaced with an
// empty string rather than left as a visible mustache.
export function applyTemplate(template: string, lead: LeadForCompose): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => {
    const k = key.toLowerCase() as keyof LeadForCompose;
    const value = lead[k];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return "";
  });
}

import type {
  ExtractedContacts,
  ExtractedEmail,
  ExtractedPhone,
  ContactFormSignal,
  ContactFormType,
  Confidence,
} from "@/lib/types";
import { validatePublicUrl } from "@/lib/utils/ssrf";
import { normalizePhone, toE164 } from "@/lib/utils/url";

// ─── Constants ──────────────────────────────────────────────────────────────

const CONTACT_PATHS = [
  "/contact",
  "/contactez-nous",
  "/about",
  "/a-propos",
  "/qui-sommes-nous",
  "/mentions-legales",
  "/legal",
  "/privacy",
  "/proprietaires",
  "/owner",
  "/owners",
  "/gestion",
  "/conciergerie",
  "/services",
  "/nos-logements",
  "/locations",
  "/properties",
  "/villas",
  "/faq",
];

const EMAIL_REGEX =
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const OBFUSCATED_EMAIL_REGEX =
  /([a-zA-Z0-9._%+\-]+)\s*[\[\(]?\s*(?:at|@|arobase)\s*[\]\)]?\s*([a-zA-Z0-9.\-]+)\s*[\[\(]?\s*(?:dot|\.)\s*[\]\)]?\s*([a-zA-Z]{2,})/gi;

const PHONE_REGEX =
  /(?:\+?(?:33|44|1|49|34|39|351)\s?)?(?:0[1-9](?:[\s.\-]?\d{2}){4}|\(?\d{2,4}\)?[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{2,4})/g;

const SPAM_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "sentry.io",
  "wix.com",
  "wordpress.com",
  "squarespace.com",
  "webflow.io",
]);

// ─── Page fetcher ────────────────────────────────────────────────────────────

async function fetchPage(url: string, timeoutMs: number): Promise<string | null> {
  const validation = validatePublicUrl(url);
  if (!validation.ok) return null;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ProspectBot/1.0; +https://prospect.io/bot)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    return await res.text();
  } catch {
    return null;
  }
}

// ─── Email extraction ────────────────────────────────────────────────────────

function extractEmailsFromHtml(html: string, sourceUrl: string): ExtractedEmail[] {
  const found = new Map<string, ExtractedEmail>();

  // 1. Extract mailto: links (highest confidence)
  const mailtoMatches = html.matchAll(/href="mailto:([^"?]+)/gi);
  for (const m of mailtoMatches) {
    const email = m[1].trim().toLowerCase();
    if (isValidEmail(email)) {
      found.set(email, { value: email, confidence: "high", source: sourceUrl });
    }
  }

  // 2. Regex over visible text (medium confidence)
  const textMatches = html.matchAll(EMAIL_REGEX);
  for (const m of textMatches) {
    const email = m[0].trim().toLowerCase();
    if (isValidEmail(email) && !found.has(email)) {
      found.set(email, { value: email, confidence: "medium", source: sourceUrl });
    }
  }

  // 3. Obfuscated formats (low confidence)
  const stripped = html.replace(/<[^>]+>/g, " ");
  const obfuscated = stripped.matchAll(OBFUSCATED_EMAIL_REGEX);
  for (const m of obfuscated) {
    const email = `${m[1].trim()}@${m[2].trim()}.${m[3].trim()}`.toLowerCase();
    if (isValidEmail(email) && !found.has(email)) {
      found.set(email, { value: email, confidence: "low", source: sourceUrl });
    }
  }

  return Array.from(found.values());
}

function isValidEmail(email: string): boolean {
  if (!email.includes("@")) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1];
  if (SPAM_EMAIL_DOMAINS.has(domain)) return false;
  if (domain.endsWith(".png") || domain.endsWith(".jpg") || domain.endsWith(".gif")) return false;
  if (email.length > 100) return false;
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email);
}

// ─── Phone extraction ────────────────────────────────────────────────────────

function extractPhonesFromHtml(html: string, sourceUrl: string): ExtractedPhone[] {
  const found = new Map<string, ExtractedPhone>();

  // 1. tel: links (highest confidence)
  const telMatches = html.matchAll(/href="tel:([^"]+)"/gi);
  for (const m of telMatches) {
    const raw = m[1].trim();
    const normalized = toE164(raw);
    const key = normalized ?? raw;
    found.set(key, {
      raw,
      normalized: normalized ?? undefined,
      confidence: "high",
      source: sourceUrl,
    });
  }

  // 2. Regex over visible text
  const stripped = html.replace(/<[^>]+>/g, " ");
  const phoneMatches = stripped.matchAll(PHONE_REGEX);
  for (const m of phoneMatches) {
    const raw = m[0].trim();
    if (raw.replace(/\D/g, "").length < 9) continue;
    const normalized = toE164(raw);
    const key = normalized ?? normalizePhone(raw);
    if (!found.has(key)) {
      found.set(key, {
        raw,
        normalized: normalized ?? undefined,
        confidence: "medium",
        source: sourceUrl,
      });
    }
  }

  return Array.from(found.values()).slice(0, 5);
}

// ─── Social links ─────────────────────────────────────────────────────────────

function extractSocialLinks(html: string): {
  instagram?: string;
  linkedin?: string;
  facebook?: string;
  whatsapp?: string;
  tiktok?: string;
  youtube?: string;
} {
  const result: Record<string, string> = {};

  const patterns: Array<[string, RegExp[]]> = [
    ["instagram", [
      /href="(https?:\/\/(?:www\.)?instagram\.com\/[^"?#\s]+)"/i,
      /href='(https?:\/\/(?:www\.)?instagram\.com\/[^'?#\s]+)'/i,
    ]],
    ["linkedin", [
      /href="(https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[^"?#\s]+)"/i,
      /href='(https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[^'?#\s]+)'/i,
    ]],
    ["facebook", [
      /href="(https?:\/\/(?:www\.)?facebook\.com\/[^"?#\s]+)"/i,
      /href='(https?:\/\/(?:www\.)?facebook\.com\/[^'?#\s]+)'/i,
    ]],
    ["whatsapp", [
      // Explicit wa.me or api.whatsapp.com links
      /href="(https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"?\s]+)"/i,
      /href='(https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^'?\s]+)'/i,
      // WhatsApp click-to-chat with phone number in URL
      /href="(https?:\/\/wa\.me\/\d+[^"?\s]*)"/i,
    ]],
    ["tiktok", [
      /href="(https?:\/\/(?:www\.)?tiktok\.com\/@[^"?#\s]+)"/i,
    ]],
    ["youtube", [
      /href="(https?:\/\/(?:www\.)?youtube\.com\/[^"?#\s]+)"/i,
    ]],
  ];

  for (const [key, patternList] of patterns) {
    for (const pattern of patternList) {
      const m = html.match(pattern);
      if (m?.[1]) {
        result[key] = m[1];
        break;
      }
    }
  }

  return result;
}

// ─── Contact form detection ────────────────────────────────────────────────

function detectContactForm(html: string, pageUrl: string): ContactFormSignal {
  const hasForm = /<form[^>]*>/i.test(html);
  if (!hasForm) return { form_found: false, form_url: null, form_type: "unknown" };

  let form_type: ContactFormType = "unknown";

  const lower = html.toLowerCase();
  if (lower.includes("confiez") || lower.includes("propriétaire") || lower.includes("votre bien")) {
    form_type = "owner_acquisition";
  } else if (lower.includes("réservation") || lower.includes("booking") || lower.includes("reservation")) {
    form_type = "booking_inquiry";
  } else if (lower.includes("devis") || lower.includes("quote") || lower.includes("estimate")) {
    form_type = "quote_request";
  } else if (lower.includes("contact") || lower.includes("message")) {
    form_type = "general_contact";
  } else if (lower.includes("séjour") || lower.includes("guest") || lower.includes("voyageur")) {
    form_type = "guest_inquiry";
  }

  return { form_found: true, form_url: pageUrl, form_type };
}

// ─── Keyword / signal extraction ──────────────────────────────────────────

const STR_KEYWORDS = [
  "conciergerie",
  "location saisonnière",
  "airbnb",
  "property management",
  "gestion locative",
  "court séjour",
  "location courte durée",
  "booking.com",
  "vrbo",
  "homeaway",
  "vacances",
  "holiday rental",
  "short-term rental",
  "short term rental",
  "confiez-nous",
  "confiez votre",
  "confiez nous",
  "superhost",
  "superhôte",
  "co-hôte",
  "cohost",
  "check-in",
  "check-out",
  "clés",
  "ménage",
  "nettoyage",
  "logement",
  "gestion airbnb",
  "gestion de location",
  "meublé tourisme",
  "gîte",
  "villa",
  "chalet",
  "mas",
  "bastide",
  "propriétaires",
  "property manager",
  "gestionnaire",
  "location meublée",
];

function extractKeywords(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
  return STR_KEYWORDS.filter((kw) => text.includes(kw));
}

function extractCompanyName(html: string): string | undefined {
  // Try og:site_name
  const ogMatch = html.match(/<meta[^>]+property="og:site_name"[^>]+content="([^"]+)"/i);
  if (ogMatch?.[1]) return ogMatch[1].trim();

  // Try title tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = titleMatch[1].trim();
    // Remove common suffixes
    return title.split(/[|\-–]/)[0].trim();
  }

  return undefined;
}

function extractNumberOfProperties(html: string): number | undefined {
  const text = html.replace(/<[^>]+>/g, " ");
  const patterns = [
    /(\d+)\s*(?:logements?|propriétés|appartements?|villas?|maisons?|biens?)\s*(?:gérés?|en gestion|sous gestion)?/i,
    /(?:gère|gérons|gérez|manage[sd]?)\s*(?:plus de\s*)?(\d+)\s*(?:logements?|properties|rentals?)/i,
    /(\d+)\s*(?:properties|listings?|rentals?)\s*(?:managed|under management)?/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) return n;
    }
  }
  return undefined;
}

// ─── Main extractor ───────────────────────────────────────────────────────

export interface CrawlOptions {
  maxPages?: number;
  timeoutMs?: number;
  concurrency?: number;
}

export async function extractContactsFromWebsite(
  baseUrl: string,
  options: CrawlOptions = {}
): Promise<ExtractedContacts | null> {
  const maxPages = options.maxPages ?? 8;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const validation = validatePublicUrl(baseUrl);
  if (!validation.ok) return null;

  // Build candidate URL list
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return null;
  }

  const urlsToTry = [
    baseUrl,
    ...CONTACT_PATHS.map((p) => `${origin}${p}`),
  ].slice(0, maxPages);

  const allEmails: ExtractedEmail[] = [];
  const allPhones: ExtractedPhone[] = [];
  let contactForm: ContactFormSignal | undefined;
  let social = {};
  let companyName: string | undefined;
  let keywords: string[] = [];
  let propertyCount: number | undefined;
  let contactPageUrl: string | undefined;

  for (const url of urlsToTry) {
    const html = await fetchPage(url, timeoutMs);
    if (!html) continue;

    const emails = extractEmailsFromHtml(html, url);
    const phones = extractPhonesFromHtml(html, url);
    const form = detectContactForm(html, url);
    const s = extractSocialLinks(html);
    const kw = extractKeywords(html);
    const name = extractCompanyName(html);
    const props = extractNumberOfProperties(html);

    allEmails.push(...emails);
    allPhones.push(...phones);

    if (form.form_found && !contactForm) {
      contactForm = form;
    }

    social = { ...s, ...social }; // earlier pages take priority

    if (!companyName && name) companyName = name;
    keywords = [...new Set([...keywords, ...kw])];
    if (!propertyCount && props) propertyCount = props;

    const isContactPage =
      url.includes("contact") ||
      url.includes("a-propos") ||
      url.includes("about");
    if (isContactPage && (emails.length > 0 || phones.length > 0)) {
      contactPageUrl = url;
    }
  }

  // Deduplicate emails (prefer highest confidence)
  const emailMap = new Map<string, ExtractedEmail>();
  const confidenceOrder: Confidence[] = ["high", "medium", "low"];
  for (const e of allEmails) {
    const existing = emailMap.get(e.value);
    if (
      !existing ||
      confidenceOrder.indexOf(e.confidence) < confidenceOrder.indexOf(existing.confidence)
    ) {
      emailMap.set(e.value, e);
    }
  }

  // Deduplicate phones
  const phoneMap = new Map<string, ExtractedPhone>();
  for (const p of allPhones) {
    const key = p.normalized ?? p.raw;
    const existing = phoneMap.get(key);
    if (
      !existing ||
      confidenceOrder.indexOf(p.confidence) < confidenceOrder.indexOf(existing.confidence)
    ) {
      phoneMap.set(key, p);
    }
  }

  const contacts: ExtractedContacts = {
    emails: Array.from(emailMap.values()).slice(0, 5),
    phones: Array.from(phoneMap.values()).slice(0, 5),
    contact_page_url: contactPageUrl,
    contact_form: contactForm,
    company_name: companyName,
    relevant_keywords: keywords,
    number_of_properties: propertyCount,
    ...(social as object),
  };

  return contacts;
}

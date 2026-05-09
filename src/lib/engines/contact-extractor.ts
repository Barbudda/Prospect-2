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

// Phone regex: negative lookahead/lookbehind prevents matching inside larger digit
// sequences (e.g. tracking IDs). Requires separators in the generic alternative so
// plain 16-digit numbers don't match.
const PHONE_REGEX =
  /(?<!\d)(?:\+?(?:33|44|1|49|34|39|351|41|32|31|352)\s?)?(?:0[1-9](?:[\s.\-]?\d{2}){4}|\(?\d{2,4}\)?[\s.\-]\d{2,4}[\s.\-]\d{2,4}(?:[\s.\-]\d{2,4})?)(?!\d)/g;

// Extensions that are never valid email TLDs (JS methods, file extensions, …)
const NON_EMAIL_EXTENSIONS = new Set([
  "push", "pop", "shift", "map", "filter", "forEach", "find", "js", "ts",
  "css", "scss", "less", "svg", "png", "jpg", "jpeg", "gif", "ico", "woff",
  "woff2", "ttf", "eot", "otf", "min", "json", "xml", "html", "htm",
  "scri", "font", "script", "queue", "layer",
]);

// Local parts that look like JavaScript expressions rather than email addresses
const JS_LOCAL_PART = /^(?:window|document|this|self|globalThis|Array|Object|Math|Date|JSON|console)\./i;

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
  const [localPart, domain] = parts;
  if (SPAM_EMAIL_DOMAINS.has(domain)) return false;
  if (email.length > 100) return false;
  if (!(/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email))) return false;
  // Reject JS expressions captured by the regex (e.g. window.d@alayer.push)
  if (JS_LOCAL_PART.test(localPart)) return false;
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  if (NON_EMAIL_EXTENSIONS.has(tld)) return false;
  // TLDs are 2–8 chars; longer strings are likely asset paths or method names
  if (tld.length < 2 || tld.length > 8) return false;
  return true;
}

function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  // Valid phone digit range: 8–15 (ITU-T E.164 max is 15)
  if (digits.length < 8 || digits.length > 15) return false;
  // Reject dates starting with a year (e.g. 20240115)
  if (/^(19|20)\d{6}/.test(digits)) return false;
  // Reject repeating-digit patterns (00000000, 11111111)
  if (/^(\d)\1{7,}$/.test(digits)) return false;
  // Reject version-number-like strings (1.2.3.4 → lots of dots)
  if ((raw.match(/\./g) ?? []).length >= 3) return false;
  return true;
}

// ─── Phone extraction ────────────────────────────────────────────────────────

function extractPhonesFromHtml(html: string, sourceUrl: string): ExtractedPhone[] {
  const found = new Map<string, ExtractedPhone>();

  // 1. tel: links (highest confidence)
  const telMatches = html.matchAll(/href="tel:([^"]+)"/gi);
  for (const m of telMatches) {
    const raw = m[1].trim();
    if (!isValidPhone(raw)) continue;
    const normalized = toE164(raw);
    const key = normalized ?? raw;
    found.set(key, {
      raw,
      normalized: normalized ?? undefined,
      confidence: "high",
      source: sourceUrl,
    });
  }

  // 2. Regex over visible text — strip tags then pre-remove date patterns
  const stripped = html
    .replace(/<[^>]+>/g, " ")
    // Remove DD/MM/YYYY and YYYY-MM-DD so they don't match the phone regex
    .replace(/\b\d{1,2}[-\/\.]\d{1,2}[-\/\.](19|20)\d{2}\b/g, " ")
    .replace(/\b(19|20)\d{2}[-\/\.]\d{1,2}[-\/\.]\d{1,2}\b/g, " ");
  const phoneMatches = stripped.matchAll(PHONE_REGEX);
  for (const m of phoneMatches) {
    const raw = m[0].trim();
    if (!isValidPhone(raw)) continue;
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

// ─── Intelligence detection ───────────────────────────────────────────────

const BOOKING_ENGINE_SIGNALS = [
  "lodgify", "smoobu", "hostaway", "guesty", "beds24", "supercontrol",
  "apaleo", "bookingsync", "krossbook", "avantio", "rentalsunited",
  "booking-engine", "reservation-engine", "reservations-widget",
  "ical", "ics", "bookdirect",
];

const CHATBOT_SIGNALS = [
  "intercom", "crisp.chat", "drift.com", "tidio", "tawk.to",
  "livechat", "freshchat", "zendesk", "messenger.com/t/",
  "hubspot.com/conversations", "botpress",
];

const OWNER_CTA_PATTERNS =
  /confiez[- ]?nous|confiez\s+votre|déposez\s+votre\s+bien|devenez\s+partenaire|rejoignez[- ]?nous|mettez\s+en\s+location|votre\s+bien\s+chez\s+nous|propriétaires,\s*rejoignez/i;

const TEAM_PATTERNS =
  /notre\s+(?:équipe|team|staff|personnel)|nos\s+(?:collaborateurs|experts|spécialistes|conseillers)|management\s+team|our\s+team|meet\s+the\s+team/i;

function detectDigitalMaturity(html: string): {
  has_faq: boolean;
  has_booking_engine: boolean;
  has_chatbot: boolean;
  automation_level: "low" | "medium" | "high";
} {
  const lower = html.toLowerCase();
  const has_faq =
    /href="[^"]*\/faq[^"]*"|foire aux questions|questions fréquentes/i.test(html);
  const has_booking_engine = BOOKING_ENGINE_SIGNALS.some((s) => lower.includes(s));
  const has_chatbot = CHATBOT_SIGNALS.some((s) => lower.includes(s));
  const digitalCount = [has_booking_engine, has_chatbot, has_faq].filter(Boolean).length;
  const hasPms = /channel.?manager|property.?management.?system|logiciel\s+de\s+gestion|automatisation|pms\b/i.test(html);
  let automation_level: "low" | "medium" | "high" = "low";
  if (digitalCount >= 2 || hasPms) automation_level = "high";
  else if (digitalCount >= 1) automation_level = "medium";
  return { has_faq, has_booking_engine, has_chatbot, automation_level };
}

function detectIntent(html: string, contactFormType?: string): {
  has_owner_acquisition_page: boolean;
  has_owner_cta: boolean;
} {
  const has_owner_cta = OWNER_CTA_PATTERNS.test(html);
  const has_owner_acquisition_page =
    has_owner_cta ||
    contactFormType === "owner_acquisition" ||
    /propriétaires|owner.*acquisition|confier.*appartement|confier.*logement/i.test(html);
  return { has_owner_acquisition_page, has_owner_cta };
}

function detectCities(html: string): string[] {
  // Look for "présents à X, Y et Z" or "disponible à X" patterns
  const text = html.replace(/<[^>]+>/g, " ");
  const matches: string[] = [];
  const presencePattern =
    /(?:présents?\s+(?:à|dans|en)|disponibles?\s+(?:à|dans)|intervenons?\s+(?:à|dans|sur)|couvrons?\s+(?:la\s+région\s+de)?)\s+([A-ZÀ-Ÿ][a-zà-ÿ\-]{2,}(?:,\s*[A-ZÀ-Ÿ][a-zà-ÿ\-]{2,})*)/gi;
  for (const m of text.matchAll(presencePattern)) {
    const cities = m[1].split(/,\s*/).map((s) => s.trim()).filter((s) => s.length > 2);
    matches.push(...cities);
  }
  return [...new Set(matches)].slice(0, 10);
}

// ─── Main extractor ───────────────────────────────────────────────────────

export interface CrawlOptions {
  maxPages?: number;
  timeoutMs?: number;
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
  // Intelligence accumulators
  let has_faq = false;
  let has_booking_engine = false;
  let has_chatbot = false;
  let automation_level: "low" | "medium" | "high" = "low";
  let has_owner_cta = false;
  let has_owner_acquisition_page = false;
  let has_team = false;
  let cities_detected: string[] = [];

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

    // Intelligence detection — accumulate across all pages
    try {
      const maturity = detectDigitalMaturity(html);
      if (maturity.has_faq) has_faq = true;
      if (maturity.has_booking_engine) has_booking_engine = true;
      if (maturity.has_chatbot) has_chatbot = true;
      if (maturity.automation_level === "high") automation_level = "high";
      else if (maturity.automation_level === "medium" && automation_level === "low") automation_level = "medium";

      const intent = detectIntent(html, contactForm?.form_type);
      if (intent.has_owner_cta) has_owner_cta = true;
      if (intent.has_owner_acquisition_page) has_owner_acquisition_page = true;

      if (!has_team && TEAM_PATTERNS.test(html)) has_team = true;

      const newCities = detectCities(html);
      cities_detected = [...new Set([...cities_detected, ...newCities])];
    } catch {
      // intelligence detection is best-effort — never crash the crawl
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
    // Intelligence signals
    has_faq,
    has_booking_engine,
    has_chatbot,
    automation_level,
    has_owner_acquisition_page,
    has_owner_cta,
    has_team,
    cities_served: cities_detected.length > 0 ? cities_detected : undefined,
  };

  return contacts;
}

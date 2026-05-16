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
import {
  validateEmail,
  validatePhone,
  findPhonesInText,
  decodeAll,
} from "@/lib/utils/contact-validator";
import type { CountryCode } from "libphonenumber-js";

// ─── Constants ──────────────────────────────────────────────────────────────

// LCEN Article 19: every French business website MUST publish identity +
// contact info on a public page. We try a wide spread of common path names
// so we don't miss the mentions légales just because it's at /legal-mentions
// instead of /mentions-legales. PRIORITY ORDER: the first few entries are
// the by-far most common locations for a real phone — these are tried
// before any other discovered URL so the maxPages budget is never wasted
// on a peripheral page when /contact wasn't even attempted.
const CONTACT_PATHS = [
  // Top-priority — almost always present and almost always carries the phone
  "/contact", "/mentions-legales", "/contactez-nous", "/nous-contacter",
  // Common secondary
  "/a-propos", "/about", "/qui-sommes-nous", "/contact-us", "/contactez", "/about-us",
  // Legal (mandatory in FR — alternate locations)
  "/mentions", "/legal", "/legal-mentions", "/legal-notice",
  "/imprint", "/impressum", "/cgv", "/cgu", "/conditions", "/conditions-generales",
  "/conditions-generales-de-vente", "/conditions-generales-utilisation",
  "/privacy", "/politique-de-confidentialite", "/cookies",
  // STR-specific
  "/proprietaires", "/owner", "/owners",
  "/gestion", "/gestion-locative", "/conciergerie", "/concierge",
  "/services", "/nos-services", "/our-services",
  "/nos-logements", "/locations", "/properties", "/villas", "/nos-locations",
  "/portfolio", "/biens", "/notre-equipe", "/team",
  "/faq", "/help", "/aide",
];

// Always-tried subset: even if the homepage has 10 hint-matching links, we
// still attempt at least these four before falling through.
const TOP_PRIORITY_PATHS = ["/contact", "/mentions-legales", "/contactez-nous", "/nous-contacter"] as const;

const EMAIL_REGEX =
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const OBFUSCATED_EMAIL_REGEX =
  /([a-zA-Z0-9._%+\-]+)\s*[\[\(]?\s*(?:at|@|arobase)\s*[\]\)]?\s*([a-zA-Z0-9.\-]+)\s*[\[\(]?\s*(?:dot|\.)\s*[\]\)]?\s*([a-zA-Z]{2,})/gi;

// TLD → default country mapping used when a page's phones are in pure local
// form ("020 7946 0958" with no leading +44). Covers the markets we care
// about plus a generic fallback to FR (our primary market).
const TLD_TO_COUNTRY: Record<string, CountryCode> = {
  fr: "FR", uk: "GB", de: "DE", es: "ES", it: "IT", be: "BE", ch: "CH",
  nl: "NL", lu: "LU", mc: "MC", pt: "PT", ie: "IE", at: "AT", dk: "DK",
  se: "SE", no: "NO", fi: "FI", pl: "PL", cz: "CZ", gr: "GR", ro: "RO",
  us: "US", ca: "CA", au: "AU", nz: "NZ", jp: "JP", br: "BR", mx: "MX",
};

function defaultCountryForUrl(url: string): CountryCode {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // Handle .co.uk → uk
    const parts = host.split(".");
    const tld = parts[parts.length - 1];
    if (TLD_TO_COUNTRY[tld]) return TLD_TO_COUNTRY[tld];
    const second = parts[parts.length - 2];
    if (second === "co" && tld === "uk") return "GB";
    if (tld === "uk") return "GB";
  } catch {
    // fall through
  }
  return "FR";
}

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

function tryAddEmail(
  raw: string,
  confidence: Confidence,
  sourceUrl: string,
  found: Map<string, ExtractedEmail>
): void {
  const result = validateEmail(raw);
  if (!result.valid || !result.cleaned) return;
  const email = result.cleaned;
  const existing = found.get(email);
  const order: Confidence[] = ["high", "medium", "low"];
  if (!existing || order.indexOf(confidence) < order.indexOf(existing.confidence)) {
    found.set(email, { value: email, confidence, source: sourceUrl });
  }
}

function extractEmailsFromHtml(html: string, sourceUrl: string): ExtractedEmail[] {
  const found = new Map<string, ExtractedEmail>();

  // 1. mailto: links — highest confidence, intentional
  const mailtoMatches = html.matchAll(/href=["']mailto:([^"'?>]+)/gi);
  for (const m of mailtoMatches) tryAddEmail(m[1], "high", sourceUrl, found);

  // 2. Schema.org JSON-LD structured data — highest confidence (curated by site owner)
  const jsonLdMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of jsonLdMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      const objs = Array.isArray(parsed) ? parsed : [parsed];
      for (const o of objs) {
        if (typeof o?.email === "string") tryAddEmail(o.email, "high", sourceUrl, found);
        if (typeof o?.contactPoint?.email === "string")
          tryAddEmail(o.contactPoint.email, "high", sourceUrl, found);
        if (Array.isArray(o?.contactPoint)) {
          for (const cp of o.contactPoint)
            if (typeof cp?.email === "string") tryAddEmail(cp.email, "high", sourceUrl, found);
        }
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }

  // 3. Microdata (itemprop="email")
  const microMatches = html.matchAll(
    /itemprop=["']email["'][^>]*?(?:content=["']([^"']+)|>([^<]+))/gi
  );
  for (const m of microMatches) tryAddEmail(m[1] ?? m[2] ?? "", "high", sourceUrl, found);

  // 4. Regex over decoded visible text (medium confidence)
  // Decode HTML entities and URL encoding BEFORE scanning — many real emails
  // are hidden behind &#64; or %40 to evade scrapers
  const decoded = decodeAll(html.replace(/<[^>]+>/g, " "));
  const textMatches = decoded.matchAll(EMAIL_REGEX);
  for (const m of textMatches) tryAddEmail(m[0], "medium", sourceUrl, found);

  // 5. Obfuscated formats (foo [at] bar [dot] com) — low confidence
  const obfuscated = decoded.matchAll(OBFUSCATED_EMAIL_REGEX);
  for (const m of obfuscated) {
    const email = `${m[1].trim()}@${m[2].trim()}.${m[3].trim()}`;
    tryAddEmail(email, "low", sourceUrl, found);
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

function tryAddPhone(
  raw: string,
  confidence: Confidence,
  sourceUrl: string,
  defaultCountry: CountryCode,
  found: Map<string, ExtractedPhone>
): void {
  const result = validatePhone(raw, defaultCountry);
  if (!result.valid || !result.e164) return;
  const key = result.e164;
  const existing = found.get(key);
  const order: Confidence[] = ["high", "medium", "low"];
  if (!existing || order.indexOf(confidence) < order.indexOf(existing.confidence)) {
    found.set(key, {
      raw: result.cleaned ?? result.international ?? result.e164,
      normalized: result.e164,
      confidence,
      source: sourceUrl,
    });
  }
}

function addPhonesFromText(
  text: string,
  confidence: Confidence,
  sourceUrl: string,
  defaultCountry: CountryCode,
  found: Map<string, ExtractedPhone>
): void {
  const order: Confidence[] = ["high", "medium", "low"];
  for (const p of findPhonesInText(text, defaultCountry)) {
    if (!p.e164) continue;
    const existing = found.get(p.e164);
    if (!existing || order.indexOf(confidence) < order.indexOf(existing.confidence)) {
      found.set(p.e164, {
        raw: p.cleaned ?? p.international ?? p.e164,
        normalized: p.e164,
        confidence,
        source: sourceUrl,
      });
    }
  }
}

function extractPhonesFromHtml(html: string, sourceUrl: string): ExtractedPhone[] {
  const found = new Map<string, ExtractedPhone>();
  const defaultCountry = defaultCountryForUrl(sourceUrl);

  // 1. tel: links — highest confidence (the operator put it in an href)
  const telMatches = html.matchAll(/href=["']tel:([^"'>]+)/gi);
  for (const m of telMatches) tryAddPhone(m[1], "high", sourceUrl, defaultCountry, found);

  // 2. WhatsApp click-to-chat — phone is in the URL itself
  const waMatches = html.matchAll(
    /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/send\?phone=)(\+?\d{8,15})/gi
  );
  for (const m of waMatches) tryAddPhone(m[1], "high", sourceUrl, defaultCountry, found);

  // 3. Schema.org JSON-LD — telephone field
  const jsonLdMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of jsonLdMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      const objs = Array.isArray(parsed) ? parsed : [parsed];
      for (const o of objs) {
        if (typeof o?.telephone === "string") tryAddPhone(o.telephone, "high", sourceUrl, defaultCountry, found);
        if (typeof o?.contactPoint?.telephone === "string")
          tryAddPhone(o.contactPoint.telephone, "high", sourceUrl, defaultCountry, found);
        if (Array.isArray(o?.contactPoint)) {
          for (const cp of o.contactPoint)
            if (typeof cp?.telephone === "string") tryAddPhone(cp.telephone, "high", sourceUrl, defaultCountry, found);
        }
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }

  // 4. Microdata (itemprop="telephone")
  const microMatches = html.matchAll(
    /itemprop=["']telephone["'][^>]*?(?:content=["']([^"']+)|>([^<]+))/gi
  );
  for (const m of microMatches) tryAddPhone(m[1] ?? m[2] ?? "", "high", sourceUrl, defaultCountry, found);

  // 5. <footer> targeted pass — legal footers are almost always where the
  //    real phone lives. We boost confidence for matches found inside footer.
  const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i);
  if (footerMatch) {
    const decodedFooter = decodeAll(
      footerMatch[0]
        .replace(/<[^>]+>/g, " ")
        .replace(/\b\d{1,2}[-\/\.]\d{1,2}[-\/\.](19|20)\d{2}\b/g, " ")
    );
    addPhonesFromText(decodedFooter, "high", sourceUrl, defaultCountry, found);
  }

  // 6. libphonenumber-powered free-text scan over the decoded body — strips
  //    HTML, kills date patterns, then hands the rest to findPhonesInText
  //    which knows every country's rules.
  const decodedBody = decodeAll(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\b\d{1,2}[-\/\.]\d{1,2}[-\/\.](19|20)\d{2}\b/g, " ")
      .replace(/\b(19|20)\d{2}[-\/\.]\d{1,2}[-\/\.]\d{1,2}\b/g, " ")
  );
  addPhonesFromText(decodedBody, "medium", sourceUrl, defaultCountry, found);

  return Array.from(found.values()).slice(0, 5);
}

// Mark the legacy helpers as referenced (kept for backwards-compat in other files)
void isValidEmail; void isValidPhone; void normalizePhone;

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
  const maxPages = options.maxPages ?? 12;
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

  // Step A — fetch the homepage first and FOLLOW any link whose anchor text
  // or href hints at the mentions-légales / contact page. This catches sites
  // where the legal page is at an unusual URL like /pages/legal-fr-23 — very
  // common on Wix/Webflow/Squarespace sites.
  const followedFromHome: string[] = [];
  try {
    const homeHtml = await fetchPage(baseUrl, timeoutMs);
    if (homeHtml) {
      const linkRe =
        /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
      const hintRe =
        /\b(?:mentions?\s*l[ée]gales?|legal\s*notice|legal\s*mentions?|imprint|impressum|cgv|cgu|contact|contactez|nous\s+contacter|propri[ée]taires?|owner|conciergerie|locations?|portfolio|biens)\b/i;
      const seen = new Set<string>();
      for (const m of homeHtml.matchAll(linkRe)) {
        const href = m[1];
        const text = m[2].replace(/<[^>]+>/g, " ").trim();
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
        const combined = `${text} ${href}`;
        if (!hintRe.test(combined)) continue;
        let abs: string;
        try {
          abs = new URL(href, baseUrl).toString();
        } catch {
          continue;
        }
        if (new URL(abs).origin !== origin) continue;
        if (seen.has(abs)) continue;
        seen.add(abs);
        followedFromHome.push(abs);
      }
    }
  } catch {
    // home-page parse failure is non-fatal; we still try the fixed paths.
  }

  // Priority order:
  //   1. baseUrl (homepage)
  //   2. TOP_PRIORITY_PATHS — /contact, /mentions-legales etc. ALWAYS tried
  //   3. up to 4 links followed from the homepage's <a> tags
  //   4. remaining CONTACT_PATHS (the longer tail)
  // The Set keeps dedup. Slice to maxPages last so the top-priority paths
  // never get dropped just because the home page had many hint links.
  const urlsToTry = Array.from(
    new Set([
      baseUrl,
      ...TOP_PRIORITY_PATHS.map((p) => `${origin}${p}`),
      ...followedFromHome.slice(0, 4),
      ...CONTACT_PATHS.map((p) => `${origin}${p}`),
    ])
  ).slice(0, maxPages);

  const allEmails: ExtractedEmail[] = [];
  const allPhones: ExtractedPhone[] = [];
  let contactForm: ContactFormSignal | undefined;
  let social = {};
  let companyName: string | undefined;
  let keywords: string[] = [];
  let propertyCount: number | undefined;
  let contactPageUrl: string | undefined;
  let ogImage: string | undefined;
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

    // Capture og:image from the homepage only (first URL = baseUrl)
    if (!ogImage && url === baseUrl) {
      const ogMatch =
        html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ??
        html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
      if (ogMatch?.[1]) ogImage = ogMatch[1].trim();
    }

    const isContactPage =
      url.includes("contact") ||
      url.includes("a-propos") ||
      url.includes("about");
    if (isContactPage && (emails.length > 0 || phones.length > 0)) {
      contactPageUrl = url;
    }

    // Intelligence signals — accumulate across all pages
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
    // Reconstruction
    page_og_image: ogImage,
  };

  return contacts;
}

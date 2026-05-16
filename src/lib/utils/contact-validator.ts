// Strict contact validators for international B2B leads.
// Run all extracted emails and phones through these before saving or displaying.
// Fixes the parsing bugs that polluted the DB with CSS classes, JS code fragments,
// URL-encoded strings, HTML entities, dates, and other non-contact patterns.
//
// Phones: backed by libphonenumber-js (Google's libphonenumber port). The
// generic `validatePhone(raw, defaultCountry?)` accepts any region; the
// legacy `validateFrenchPhone(raw)` stays as a thin wrapper that returns
// the same shape as before so existing callers don't break.

// Import from `/max` so the full per-country metadata is loaded. The default
// entry point resolves to the `min` build on some loaders (tsx, certain
// bundler configs) and the reduced metadata makes calls throw
// `Cannot read properties of undefined (reading 'hasOwnProperty')` inside
// `isSupportedCountry` for any region not in the trimmed list. `/max` is
// the documented import for full worldwide validation.
import {
  parsePhoneNumberFromString,
  findPhoneNumbersInText,
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js/max";

// ─── Decoders ─────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
  "&#39;": "'", "&nbsp;": " ",
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m);
}

function decodeUrlEncoding(s: string): string {
  // Iterative — handles double-encoded strings like %2520
  let prev = s;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(prev);
      if (next === prev) break;
      prev = next;
    } catch {
      break;
    }
  }
  return prev;
}

// Normalise the menagerie of Unicode whitespace characters real French and
// other European sites use between phone-number digit groups. Without this,
// libphonenumber sees something like "06 12 34 56 78"
// as a single digit blob and refuses to parse it.
function normalizeUnicodeWhitespace(s: string): string {
  return s
    .replace(/ /g, " ")   // NO-BREAK SPACE
    .replace(/ /g, " ")   // NARROW NO-BREAK SPACE (FR-canonical)
    .replace(/ /g, " ")   // FIGURE SPACE
    .replace(/ /g, " ")   // THIN SPACE
    .replace(/​/g, "")    // ZERO-WIDTH SPACE — drop entirely
    .replace(/‌/g, "")    // ZERO-WIDTH NON-JOINER
    .replace(/‍/g, "");   // ZERO-WIDTH JOINER
}

export function decodeAll(s: string): string {
  return normalizeUnicodeWhitespace(decodeHtmlEntities(decodeUrlEncoding(s)));
}

// ─── Email validation ─────────────────────────────────────────────────────────

// Strict whitelist of real TLDs we accept. Worldwide coverage but still
// strict enough to reject parsing artefacts like .push, .match, .stars,
// .cocoonr, .useragent that the regex falsely produces.
const VALID_TLDS = new Set([
  // Europe
  "fr", "com", "org", "net", "eu", "uk", "de", "es", "it", "be", "ch", "nl",
  "lu", "mc", "pt", "ie", "at", "dk", "se", "no", "fi", "pl", "cz", "gr",
  "ro", "hu", "bg", "hr", "si", "sk", "ee", "lv", "lt", "is", "cy", "mt",
  "gg", "je", "im", "ad", "al", "ba", "by", "li", "md", "me", "mk", "rs",
  "sm", "ua", "va",
  // Americas
  "us", "ca", "mx", "ar", "br", "cl", "co", "pe", "uy", "py", "ec", "ve",
  "bo", "cr", "do", "gt", "hn", "ni", "pa", "sv", "cu", "pr",
  // Asia-Pacific
  "au", "nz", "jp", "kr", "cn", "hk", "tw", "sg", "my", "th", "vn", "ph",
  "id", "in", "pk", "bd", "lk", "kh", "la", "mm", "mn", "kz", "uz", "tj",
  // Middle East
  "ae", "sa", "il", "tr", "qa", "kw", "om", "bh", "jo", "lb", "ir", "iq",
  // Africa
  "za", "ng", "ke", "eg", "ma", "tn", "dz", "gh", "ci", "et", "tz", "ug",
  "sn", "rw", "cm", "zw", "zm", "mu", "re",
  // Russia + ex-USSR
  "ru", "su",
  // Generic
  "io", "co", "app", "dev", "info", "biz", "me", "tv", "name", "pro", "mobi",
  "online", "site", "tech", "digital", "agency", "company", "business",
  "group", "club", "shop", "store", "expert", "guru", "team", "live", "life",
  "world", "space", "website", "blog", "studio", "design", "media", "page",
  "global", "international", "network", "solutions", "services", "ventures",
  // STR-relevant
  "travel", "paris", "london", "berlin", "tokyo", "nyc", "hotels", "hotel",
  "rentals", "villas", "villa", "house", "home", "homes", "realty", "estate",
  "properties", "vacation", "vacations", "tourism", "holiday", "holidays",
  "tours", "city", "guide", "host", "rest", "place", "boutique",
]);

// Local-part patterns that betray JS code or CSS classes
const JS_CSS_LOCAL_PATTERNS: RegExp[] = [
  // CSS class prefixes
  /^(?:wp-|js-|css-|el-|btn-|ico-|tw-|tailwind|fa-|mui-|ant-)/i,
  // JS object access expressions
  /^(?:window|document|self|globalThis|navigator|location|history|console|math|object|array|date|json|number|string|regexp|map|set|promise|fetch|require|import|exports|module|process|global|null|undefined|true|false|datalayer|gtag|fbq|gtm|hbspt|piwik|matomo|_paq|ga|tracker|analytics|pixel)\./i,
];

// Method-name patterns that indicate the "TLD" is actually a JS method call
const JS_METHOD_TLDS = new Set([
  "push", "pop", "shift", "unshift", "map", "filter", "foreach", "find",
  "reduce", "some", "every", "includes", "indexof", "join", "split", "slice",
  "splice", "concat", "reverse", "sort", "tostring", "tofixed", "tolowercase",
  "touppercase", "trim", "replace", "match", "test", "exec", "then", "catch",
  "finally", "bind", "call", "apply", "hasownproperty", "isprototypeof",
  "setitem", "getitem", "removeitem", "queryselector", "queryselectorall",
  "getelementbyid", "getelementsbyclassname", "appendchild", "removechild",
  "addeventlistener", "removeeventlistener", "preventdefault",
  "stoppropagation", "getattribute", "setattribute", "removeattribute",
  "classlist", "innerhtml", "outerhtml", "innertext", "textcontent",
  "useragent", "cookie", "localstorage", "sessionstorage",
  // File extensions wrongly matched as TLDs
  "js", "ts", "tsx", "jsx", "css", "scss", "less", "svg", "png", "jpg",
  "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot", "otf", "min", "json",
  "xml", "html", "htm", "pdf", "zip", "rar", "mp4", "mp3", "webm",
  // Other common false TLDs
  "scri", "font", "script", "queue", "layer", "stars", "loading", "block",
  "templ", "post",
]);

const SPAM_DOMAINS = new Set([
  "example.com", "example.org", "example.fr", "example.net",
  "test.com", "test.fr", "domain.com", "yourdomain.com", "email.com",
  "mail.com", "sentry.io", "wix.com", "wordpress.com", "squarespace.com",
  "webflow.io", "u003e.com", "u003c.com", "via.placeholder.com",
  "placeholder.com", "noreply.com", "no-reply.com",
]);

// Domain SUFFIXES that indicate the email is a CDN/asset URL split badly
const CDN_DOMAIN_SUFFIXES = [
  "fbcdn.net",        // st@ic.xx.fbcdn.net — Facebook CDN
  "cdninstagram.com", // st@ic.cdninstagram.com — Instagram CDN
  "akamaihd.net",
  "cloudfront.net",
  "cloudflare.com",
  "googleusercontent.com",
  "gstatic.com",      // fonts.gst@ic.com (split)
  "ssl-images.com",
  "cdn.shopify.com",
  "twimg.com",
];

// Local parts that are obvious placeholders, not real emails. Kept tight on
// purpose: "user", "name", "email", "info" are legitimately used by real
// operators ("user@brand.com.au", "name@firm.io"), so they DO NOT belong
// in the placeholder reject-list.
const PLACEHOLDER_LOCALS = new Set([
  "your-email", "youremail", "your_email",
  "yourname", "your-name",
  "votre-email", "votreemail",
  "example", "examples",
]);

export interface ValidationResult {
  valid: boolean;
  cleaned?: string;
  reason?: string;
}

export function validateEmail(raw: string): ValidationResult {
  if (!raw || typeof raw !== "string") return { valid: false, reason: "empty" };

  const decoded = decodeAll(raw).trim().toLowerCase();
  if (decoded.length < 5 || decoded.length > 100) return { valid: false, reason: "length" };
  if (!decoded.includes("@")) return { valid: false, reason: "no_at" };

  const parts = decoded.split("@");
  if (parts.length !== 2) return { valid: false, reason: "multiple_at" };

  const [localPart, domain] = parts;

  // Local part rules
  if (!localPart || localPart.length < 1 || localPart.length > 64)
    return { valid: false, reason: "local_length" };
  if (localPart.startsWith(".") || localPart.endsWith("."))
    return { valid: false, reason: "local_dots" };
  if (localPart.includes(".."))
    return { valid: false, reason: "consecutive_dots" };
  if (!/^[a-z0-9._%+\-]+$/.test(localPart))
    return { valid: false, reason: "local_chars" };

  // Reject local parts that look like CSS classes or JS expressions
  for (const pattern of JS_CSS_LOCAL_PATTERNS) {
    if (pattern.test(localPart)) return { valid: false, reason: "js_css_local" };
  }

  // Domain rules
  if (!domain || domain.length < 4 || domain.length > 253)
    return { valid: false, reason: "domain_length" };
  if (domain.startsWith(".") || domain.endsWith("."))
    return { valid: false, reason: "domain_dots" };
  if (!domain.includes("."))
    return { valid: false, reason: "no_tld" };
  if (!/^[a-z0-9.\-]+$/.test(domain))
    return { valid: false, reason: "domain_chars" };

  // TLD must be in real-TLD whitelist OR last label must not be a JS method
  const labels = domain.split(".");
  const tld = labels[labels.length - 1];

  if (JS_METHOD_TLDS.has(tld)) return { valid: false, reason: `js_method_tld:${tld}` };
  if (!VALID_TLDS.has(tld)) return { valid: false, reason: `unknown_tld:${tld}` };

  // Domain must have a recognisable second-level label
  if (labels.length < 2) return { valid: false, reason: "no_sld" };
  const sld = labels[labels.length - 2];
  if (!sld || sld.length < 2) return { valid: false, reason: "sld_too_short" };

  if (SPAM_DOMAINS.has(domain)) return { valid: false, reason: "spam_domain" };

  // Reject CDN/asset domains by suffix (catches `st@ic.xx.fbcdn.net`,
  // `st@ic.cdninstagram.com`, `fonts.gst@ic.com` and similar)
  for (const suffix of CDN_DOMAIN_SUFFIXES) {
    if (domain === suffix || domain.endsWith("." + suffix)) {
      return { valid: false, reason: `cdn_domain:${suffix}` };
    }
  }

  // Reject obvious placeholder locals
  if (PLACEHOLDER_LOCALS.has(localPart))
    return { valid: false, reason: `placeholder:${localPart}` };

  // Heuristic: reject locals that look like CSS/JS class fragments where
  // the "SLD" is a 2-char artefact like "ic.com" or "x.fr". Only fires for
  // exactly-two-label domains so legitimate compound TLDs (co.uk, co.jp,
  // com.au, com.sg, ne.jp, …) survive — those have ≥3 labels and the
  // 2-char label is the registry suffix, not the brand.
  if (labels.length === 2 && sld.length === 2 && tld.length <= 3) {
    return { valid: false, reason: `short_sld:${sld}.${tld}` };
  }

  return { valid: true, cleaned: decoded };
}

// ─── Worldwide phone validation (libphonenumber-js) ───────────────────────────
// Single source of truth for every phone we keep. Accepts any country, falls
// back to the caller's hint (or France) when the number is in local form.

export interface PhoneValidationResult {
  valid: boolean;
  /** Caller-friendly national format, e.g. "06 12 34 56 78" or "020 7946 0958". */
  cleaned?: string;
  /** E.164 form for DB storage / dedup, e.g. "+33612345678". */
  e164?: string;
  /** International display form, e.g. "+33 6 12 34 56 78". */
  international?: string;
  /** ISO 3166-1 alpha-2 country code parsed by libphonenumber. */
  country?: CountryCode;
  reason?: string;
}

// Numbers we never want to store, regardless of what libphonenumber says.
// These are not invalid technically but are useless for B2B outreach.
const PHONE_PATTERN_REJECT: Array<{ re: RegExp; reason: string }> = [
  { re: /^(\d)\1{6,}$/, reason: "repeating" },              // 8+ identical digits
  { re: /^0?(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/, reason: "date_pattern" },
  { re: /^0?123456789?0?$/, reason: "sequential_asc" },
  { re: /^0?9876543210?$/, reason: "sequential_desc" },
];

// FR-only safety net: special-rate prefixes that pass libphonenumber but are
// commercially useless (premium 08xx, etc.). Other countries have their own
// equivalents but we only block FR explicitly here — for the rest we trust
// libphonenumber and let business filters handle the rest.
function isUselessFrenchNumber(e164: string): { useless: boolean; reason?: string } {
  if (!e164.startsWith("+33")) return { useless: false };
  const national = "0" + e164.slice(3);
  if (/^08\d{8}$/.test(national)) return { useless: true, reason: "special_rate_08" };
  return { useless: false };
}

export function validatePhone(
  raw: string,
  defaultCountry: CountryCode = "FR"
): PhoneValidationResult {
  if (!raw || typeof raw !== "string") return { valid: false, reason: "empty" };
  if (raw.length > 60) return { valid: false, reason: "raw_too_long" };

  // Decode entities + URL encoding so &#43;33... and %2B33... become +33...
  let decoded = decodeAll(raw).trim();

  // The very common French write-style "+33 (0)5 59 74 10 32" — libphonenumber
  // handles it but only when the "(0)" sits in the right spot. Normalise first
  // so we don't depend on the library's exact tolerance window.
  decoded = decoded.replace(/(\+|00)(\d{1,3})[\s.\-]*\(0\)/gi, "+$2");
  // Strip a leading "(0)" used in local form: "(0)5 59 …"
  decoded = decoded.replace(/^\(0\)/, "");
  // 00 → + for international prefix
  decoded = decoded.replace(/^00(\d)/, "+$1");

  // Quick digit sanity before libphonenumber: phones have 6-15 digits (ITU-T).
  const digits = decoded.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) {
    return { valid: false, reason: `length:${digits.length}d` };
  }

  // Pure-digits-no-separator-and-not-international: a raw integer like
  // "134217728" (which is literally 2^27) parses as a valid French landline
  // because libphonenumber inserts the implicit trunk prefix. In practice
  // this pattern is almost always a JavaScript constant scraped from a
  // <script> body, not a phone. Real human-written phones either start with
  // "+" / "00", or include at least one separator character. We require one
  // of those signals for any 9-or-fewer-digit input.
  const hasInternationalPrefix = /^(\+|00)/.test(decoded);
  const hasSeparator = /[\s.\-/()]/.test(decoded.replace(/^\+?/, ""));
  if (!hasInternationalPrefix && !hasSeparator && digits.length < 10) {
    return { valid: false, reason: "ambiguous_raw_integer" };
  }

  // Pattern-reject obvious junk before libphonenumber wastes cycles.
  for (const r of PHONE_PATTERN_REJECT) {
    if (r.re.test(digits)) return { valid: false, reason: r.reason };
  }

  let parsed: PhoneNumber | undefined;
  try {
    parsed = parsePhoneNumberFromString(decoded, defaultCountry);
  } catch {
    return { valid: false, reason: "parse_error" };
  }
  if (!parsed) return { valid: false, reason: "no_parse" };
  if (!parsed.isValid()) {
    return { valid: false, reason: `invalid_for_${parsed.country ?? "??"}` };
  }

  const e164 = parsed.number; // "+33612345678"
  const country = parsed.country;

  // Reject useless French categories — premium 08xx etc.
  const fr = isUselessFrenchNumber(e164);
  if (fr.useless) return { valid: false, reason: fr.reason };

  // Reject mass-spam / fake patterns: repeats of a single subscriber digit
  // after the country code (e.g. +12111111111).
  const subscriber = e164.replace(/^\+\d{1,3}/, "");
  if (/^(\d)\1{6,}$/.test(subscriber)) return { valid: false, reason: "repeating_subscriber" };

  return {
    valid: true,
    e164,
    international: parsed.formatInternational(),
    cleaned: parsed.formatNational(),
    country,
  };
}

/**
 * Walk a free-text blob and return every well-formed phone number it contains.
 * Wraps libphonenumber's findPhoneNumbersInText, then re-runs each match
 * through `validatePhone` against its raw substring so the same junk rules
 * (ambiguous bare-integer rejection, SIREN-shape patterns, useless French
 * categories) apply consistently. This catches bare 9-digit runs like
 * "Registration code: 123456789" that libphonenumber would otherwise turn
 * into +33123456789 (a fake Paris landline).
 */
export function findPhonesInText(
  text: string,
  defaultCountry: CountryCode = "FR"
): PhoneValidationResult[] {
  if (!text || typeof text !== "string") return [];
  const decoded = decodeAll(text);
  const out: PhoneValidationResult[] = [];
  const seen = new Set<string>();
  try {
    for (const match of findPhoneNumbersInText(decoded, defaultCountry)) {
      const num = match.number;
      if (!num.isValid()) continue;
      const e164 = num.number;
      if (seen.has(e164)) continue;

      // Pull the raw substring that libphonenumber matched. If the raw is
      // a bare digit run with no separators and no `+` prefix, treat it as
      // an ambiguous registration / order number rather than a phone.
      const rawSpan = typeof match.startsAt === "number" && typeof match.endsAt === "number"
        ? decoded.slice(match.startsAt, match.endsAt)
        : "";
      const hasIntPrefix = /^[\s(]*(\+|00)/.test(rawSpan);
      const hasSeparator = /[\s.\-()  ]/.test(rawSpan.replace(/^\+?\d{1,3}/, ""));
      const digitsOnly = rawSpan.replace(/\D/g, "");
      if (!hasIntPrefix && !hasSeparator && digitsOnly.length < 10) continue;

      seen.add(e164);
      // Pattern-reject junk
      const subscriber = e164.replace(/^\+\d{1,3}/, "");
      if (/^(\d)\1{6,}$/.test(subscriber)) continue;
      const fr = isUselessFrenchNumber(e164);
      if (fr.useless) continue;
      out.push({
        valid: true,
        e164,
        international: num.formatInternational(),
        cleaned: num.formatNational(),
        country: num.country,
      });
    }
  } catch {
    // libphonenumber should never throw, but be safe.
  }
  return out;
}

// ─── French phone validation (back-compat wrapper) ────────────────────────────
// Keeps the legacy `{valid, cleaned, reason}` shape that older callers depend
// on. Under the hood it now uses libphonenumber, with `FR` as the default
// region so existing behaviour (accept "06 12 34 56 78" without an explicit
// country) is preserved. The `cleaned` field is the French national form
// "06 12 34 56 78" exactly like before — we re-format from E.164 to match
// the spaced 2-digit grouping the rest of the app expects.

export function validateFrenchPhone(raw: string): ValidationResult {
  const r = validatePhone(raw, "FR");
  if (!r.valid) return { valid: false, reason: r.reason };
  // libphonenumber returns French national format as "06 12 34 56 78" already
  // (matches our previous output). Only re-space if it differs.
  if (r.country && r.country !== "FR") {
    // The caller asked for FR but got a foreign number — for back-compat,
    // refuse it so the old strict French gate behaves identically.
    return { valid: false, reason: `not_fr:${r.country}` };
  }
  // Defensive re-format in case libphonenumber's national form ever drifts.
  if (r.e164 && r.e164.startsWith("+33")) {
    const local = "0" + r.e164.slice(3);
    if (/^0[1-9]\d{8}$/.test(local)) {
      const spaced = local.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5");
      return { valid: true, cleaned: spaced };
    }
  }
  return { valid: true, cleaned: r.cleaned };
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

export function cleanEmail(raw: string): string | null {
  const r = validateEmail(raw);
  return r.valid ? r.cleaned! : null;
}

export function cleanPhone(raw: string, defaultCountry: CountryCode = "FR"): string | null {
  const r = validatePhone(raw, defaultCountry);
  return r.valid ? r.e164 ?? r.cleaned ?? null : null;
}

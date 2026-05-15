// Strict contact validators for French B2B leads.
// Run all extracted emails and phones through these before saving or displaying.
// Fixes the parsing bugs that polluted the DB with CSS classes, JS code fragments,
// URL-encoded strings, HTML entities, dates, and other non-contact patterns.

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

export function decodeAll(s: string): string {
  return decodeHtmlEntities(decodeUrlEncoding(s));
}

// ─── Email validation ─────────────────────────────────────────────────────────

// Strict whitelist of real TLDs we accept. French B2B market focus.
// Rejects fake TLDs like .push, .match, .stars, .cocoonr, .useragent
const VALID_TLDS = new Set([
  // Geographic — Europe + key markets
  "fr", "com", "org", "net", "eu", "uk", "de", "es", "it", "be", "ch", "nl",
  "lu", "mc", "pt", "ie", "at", "dk", "se", "no", "fi", "pl", "cz", "gr",
  "ro", "hu", "bg", "hr", "si", "sk", "ee", "lv", "lt", "is",
  // Geographic — overseas
  "us", "ca", "au", "nz", "jp", "kr", "br", "mx", "ar", "cl", "co",
  // Generic
  "io", "co", "app", "dev", "info", "biz", "me", "tv", "name", "pro", "mobi",
  "online", "site", "tech", "digital", "agency", "company", "business",
  "group", "club", "shop", "store", "expert", "guru", "team", "live", "life",
  "world", "space", "website", "blog", "studio", "design", "media",
  // STR-relevant
  "travel", "paris", "hotels", "hotel", "rentals", "villas", "villa",
  "house", "home", "homes", "realty", "estate", "properties", "vacation",
  "tourism", "holiday", "tours", "city", "guide",
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

// Local parts that are obvious placeholders, not real emails
const PLACEHOLDER_LOCALS = new Set([
  "name", "email", "your-email", "youremail", "user", "test", "demo",
  "support@superhote", // matched as literal once decoded — false positive guard
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

  // Heuristic: reject locals that look like CSS/JS class fragments
  // (one or two-letter local + dotted weirdness, e.g. "st@ic.xx.fbcdn.net" already
  //  caught by CDN; "m@h.random" caught by unknown_tld; "fonts.gst@ic.com" → local
  //  "fonts.gst" is plausible but domain "ic.com" alone is fishy. Reject 2-char SLDs.)
  if (sld.length === 2 && tld.length <= 3) {
    // "ic.com", "x.fr" — almost always parser artefacts. Real 2-letter SLDs are
    // either national subdomains (co.uk etc., where the tld is 2) or vanity
    // (q.com), but in our B2B context they're noise.
    return { valid: false, reason: `short_sld:${sld}.${tld}` };
  }

  return { valid: true, cleaned: decoded };
}

// ─── French phone validation ──────────────────────────────────────────────────
// Strict: must be exactly 10 digits after normalization, starting with 0[1-9].
// Accepts: 06 12 34 56 78, +33 6 12 34 56 78, 0033612345678, %2B33..., HTML entities

export function validateFrenchPhone(raw: string): ValidationResult {
  if (!raw || typeof raw !== "string") return { valid: false, reason: "empty" };

  // Raw must not be absurdly long — phones max ~25 chars even fully formatted
  if (raw.length > 40) return { valid: false, reason: "raw_too_long" };

  // Decode entities + URL encoding FIRST — many bad phones are encoded valid ones
  const decoded = decodeAll(raw);

  // Strip everything except digits and leading +
  let digits = decoded.replace(/[^\d+]/g, "");

  // Convert international format to national
  if (digits.startsWith("+33")) digits = "0" + digits.slice(3);
  else if (digits.startsWith("0033")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("33") && digits.length === 11) digits = "0" + digits.slice(2);

  // Reject any leftover '+' or non-digits
  if (!/^\d+$/.test(digits)) return { valid: false, reason: "non_digits" };

  // Final form must be exactly 10 digits starting with 0[1-9]
  if (!/^0[1-9]\d{8}$/.test(digits))
    return { valid: false, reason: `format:${digits.length}d` };

  // Reject special-rate numbers (08xx) — almost always premium/scam for B2B context.
  // 09 (VoIP/non-geographic) is kept; legitimate professionals use it.
  if (digits.startsWith("08")) return { valid: false, reason: "special_rate_08" };

  // Reject repeating-digit patterns (0111111111, 0222222222…)
  if (/^0(\d)\1{8}$/.test(digits)) return { valid: false, reason: "repeating" };

  // Reject 3+ consecutive identical digits anywhere (e.g. 0123444444) — usually
  // a parsing artefact, not a real number
  if (/(\d)\1{5,}/.test(digits)) return { valid: false, reason: "long_run" };

  // Reject sequential patterns
  if (digits === "0123456789" || digits === "0987654321")
    return { valid: false, reason: "sequential" };

  // Reject obvious non-phones: anything that's a date YYYYMMDD prefix
  if (/^0?(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/.test(digits))
    return { valid: false, reason: "date_pattern" };

  // Format as 06 12 34 56 78
  const formatted = digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4 $5");
  return { valid: true, cleaned: formatted };
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

export function cleanEmail(raw: string): string | null {
  const r = validateEmail(raw);
  return r.valid ? r.cleaned! : null;
}

export function cleanPhone(raw: string): string | null {
  const r = validateFrenchPhone(raw);
  return r.valid ? r.cleaned! : null;
}

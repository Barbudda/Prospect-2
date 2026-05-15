// DIRECT BOOKING WEBSITE AUDITOR
//
// Public, lawful, read-only inspection of a lead's website. No crawling of
// restricted areas, no auth, no scraping behind login. Only the public HTML
// served on the homepage (and one /contact attempt for trust signals).
//
// Output: audit score 0-100, prioritised findings with severity, lost-revenue
// hypothesis, recommended fixes, and an outreach snippet — all derived from
// signals on the public page that Mammouth converts into a one-paragraph hook.
//
// Compliance:
//  - Source: public web page served at the lead's website_url
//  - Lawful basis: legitimate interest (B2B outreach insight)
//  - Personal data: none collected; we only analyse business metadata
//  - Retention: result is ephemeral by default; not persisted unless the caller
//    chooses to store it via the API route

import * as Mammouth from "@/lib/providers/mammouth";
import { validatePublicUrl } from "@/lib/utils/ssrf";

export type Severity = "low" | "medium" | "high";

export interface AuditFinding {
  code: string;
  severity: Severity;
  description: string;
}

export interface WebsiteAudit {
  url: string;
  fetched: boolean;
  status_code?: number;
  fetch_ms?: number;
  html_bytes?: number;
  audit_score: number;            // 0-100, higher = healthier
  findings: AuditFinding[];
  signals: {
    has_viewport_meta: boolean;
    has_schema_jsonld: boolean;
    schema_types: string[];
    has_booking_engine: boolean;
    booking_engine: string | null;
    has_multilingual: boolean;
    detected_languages: string[];
    has_analytics: boolean;
    analytics_vendors: string[];
    has_pixel: boolean;
    has_mailto: boolean;
    has_newsletter_capture: boolean;
    copyright_year: number | null;
    copyright_stale: boolean;
    has_reviews_widget: boolean;
    has_legal_link: boolean;
    image_count: number;
    title: string | null;
    description: string | null;
  };
  lost_revenue_hypothesis?: string;
  recommended_fixes: string[];
  outreach_snippet?: string;
}

// ─── Public PMS / booking engine signatures ──────────────────────────────────
const BOOKING_ENGINES: Array<[string, RegExp]> = [
  ["Lodgify", /lodgify\.com|lodgify-widget|lodgifyembed/i],
  ["Smoobu", /smoobu\.com|smoobu-widget/i],
  ["Hostaway", /hostaway\.com|hostaway-widget/i],
  ["Beds24", /beds24\.com|beds24-booking/i],
  ["Avantio", /avantio\.com|avantiowidget/i],
  ["SuperControl", /supercontrol\.co\.uk/i],
  ["Apaleo", /apaleo\.com/i],
  ["BookingSync", /bookingsync\.com/i],
  ["Guesty", /guesty\.com|guestyfordev/i],
  ["RentalsUnited", /rentalsunited\.com/i],
  ["Kross Booking", /krossbooking\.com|krossbook/i],
  ["Bookalet", /bookalet\.co\.uk/i],
  ["Generic iCal", /\.ics\b/i],
];

const ANALYTICS_VENDORS: Array<[string, RegExp]> = [
  ["Google Analytics", /googletagmanager\.com\/gtag|google-analytics\.com|GA_MEASUREMENT_ID|gtag\(/i],
  ["Google Tag Manager", /googletagmanager\.com\/gtm/i],
  ["Meta Pixel", /connect\.facebook\.net\/.*\/fbevents\.js|fbq\(/i],
  ["TikTok Pixel", /analytics\.tiktok\.com\/i18n\/pixel/i],
  ["Matomo / Piwik", /matomo\.js|piwik\.js|_paq\.push/i],
  ["Plausible", /plausible\.io\/js\//i],
  ["Hotjar", /static\.hotjar\.com/i],
  ["Hubspot", /js\.hs-scripts\.com|js\.hsadspixel\.net/i],
];

function fetchTimeout(url: string, ms: number): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ProspectAuditor/1.0; +https://prospect.io/bot)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
  });
}

function detect(html: string, patterns: Array<[string, RegExp]>): string[] {
  const found: string[] = [];
  for (const [name, re] of patterns) {
    if (re.test(html)) found.push(name);
  }
  return found;
}

function extractSchemaTypes(html: string): string[] {
  const out = new Set<string>();
  const matches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1]);
      const objs = Array.isArray(parsed) ? parsed : [parsed];
      for (const o of objs) {
        const t = (o as { "@type"?: string | string[] })["@type"];
        if (typeof t === "string") out.add(t);
        if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
      }
    } catch {
      // malformed JSON-LD — ignore
    }
  }
  return Array.from(out);
}

function extractCopyrightYear(html: string): number | null {
  // Find the most recent 4-digit year in "© 20XX" / "Copyright 20XX"
  const m = html.match(/(?:©|&copy;|copyright)[^0-9]{0,40}(20\d{2})/i);
  if (m) return parseInt(m[1], 10);
  const fallback = html.match(/(?:©|&copy;)\s*(20\d{2})/i);
  return fallback ? parseInt(fallback[1], 10) : null;
}

function extractHreflang(html: string): string[] {
  const tags = html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([a-z-]+)["']/gi);
  const langs = new Set<string>();
  for (const m of tags) langs.add(m[1].toLowerCase());
  return Array.from(langs);
}

function metaContent(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  return html.match(re)?.[1] ?? null;
}

// ─── Audit core ──────────────────────────────────────────────────────────────

export async function auditWebsite(
  url: string,
  opts: { generate_outreach?: boolean } = {}
): Promise<WebsiteAudit> {
  const empty: WebsiteAudit = {
    url,
    fetched: false,
    audit_score: 0,
    findings: [],
    signals: {
      has_viewport_meta: false,
      has_schema_jsonld: false,
      schema_types: [],
      has_booking_engine: false,
      booking_engine: null,
      has_multilingual: false,
      detected_languages: [],
      has_analytics: false,
      analytics_vendors: [],
      has_pixel: false,
      has_mailto: false,
      has_newsletter_capture: false,
      copyright_year: null,
      copyright_stale: false,
      has_reviews_widget: false,
      has_legal_link: false,
      image_count: 0,
      title: null,
      description: null,
    },
    recommended_fixes: [],
  };

  if (!validatePublicUrl(url).ok) {
    empty.findings.push({
      code: "url_unsafe",
      severity: "high",
      description: "URL blocked by SSRF validator — cannot audit.",
    });
    return empty;
  }

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetchTimeout(url, 12_000);
  } catch (err) {
    empty.findings.push({
      code: "fetch_failed",
      severity: "high",
      description: `Website unreachable: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    return empty;
  }

  const status_code = res.status;
  const fetch_ms = Date.now() - t0;
  let html = "";
  if (res.ok) {
    try {
      html = await res.text();
    } catch {
      // empty
    }
  }

  const html_bytes = html.length;

  if (!res.ok || !html) {
    return {
      ...empty,
      status_code,
      fetch_ms,
      html_bytes,
      findings: [
        ...empty.findings,
        {
          code: "fetch_status",
          severity: "high",
          description: `HTTP ${status_code} — public homepage not delivering content.`,
        },
      ],
    };
  }

  // ── Signal extraction ──────────────────────────────────────────────────────
  const has_viewport_meta = /<meta[^>]+name=["']viewport["']/i.test(html);
  const schema_types = extractSchemaTypes(html);
  const has_schema_jsonld = schema_types.length > 0;
  const booking_engine = BOOKING_ENGINES.find(([, re]) => re.test(html))?.[0] ?? null;
  const has_booking_engine = booking_engine !== null;
  const detected_languages = extractHreflang(html);
  const lang_attr = html.match(/<html[^>]+lang=["']([a-z-]+)["']/i)?.[1]?.toLowerCase();
  if (lang_attr) detected_languages.push(lang_attr);
  const uniqueLangs = Array.from(new Set(detected_languages));
  const has_multilingual = uniqueLangs.length >= 2;
  const analytics_vendors = detect(html, ANALYTICS_VENDORS);
  const has_analytics = analytics_vendors.length > 0;
  const has_pixel = /fbq\(|tiktok.*pixel|linkedin_data_partner_id|twq\(/i.test(html);
  const has_mailto = /href=["']mailto:/i.test(html);
  const has_newsletter_capture =
    /type=["']email["'][^>]*(?:name=["']email|name=["']newsletter|placeholder=["'][^"']*(?:newsletter|email|inscri))/i.test(
      html
    ) || /newsletter|inscription|s'abonner|subscribe/i.test(html);
  const copyright_year = extractCopyrightYear(html);
  const currentYear = new Date().getFullYear();
  const copyright_stale =
    copyright_year !== null && currentYear - copyright_year >= 2;
  const has_reviews_widget =
    /trustpilot|google-reviews|reviews-io|elfsight\.com\/reviews|widget.*reviews/i.test(
      html
    );
  const has_legal_link =
    /href=["'][^"']*\/(mentions-legales|legal|terms|cgu|privacy|politique)[^"']*["']/i.test(
      html
    );
  const image_count = (html.match(/<img\s/gi) ?? []).length;
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
  const description = metaContent(html, "description");

  // ── Score + findings ───────────────────────────────────────────────────────
  let score = 100;
  const findings: AuditFinding[] = [];
  const fixes: string[] = [];

  if (!has_viewport_meta) {
    score -= 10;
    findings.push({
      code: "no_viewport",
      severity: "high",
      description: "Missing mobile viewport meta — site is unusable on phones.",
    });
    fixes.push('Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  }
  if (!has_schema_jsonld) {
    score -= 12;
    findings.push({
      code: "no_schema",
      severity: "medium",
      description:
        "No Schema.org JSON-LD markup. Google can't reliably read your property as a LodgingBusiness.",
    });
    fixes.push("Add JSON-LD structured data: LodgingBusiness, Product, FAQPage, Review.");
  } else if (!schema_types.some((t) => /Lodging|Hotel|VacationRental|BedAndBreakfast|Hostel|Resort|Apartment|Accommodation/i.test(t))) {
    score -= 5;
    findings.push({
      code: "schema_wrong_type",
      severity: "low",
      description: `Has Schema (${schema_types.join(", ")}) but not a lodging type — Google can't surface rich results.`,
    });
    fixes.push("Add a LodgingBusiness or VacationRental @type to JSON-LD.");
  }
  if (!has_booking_engine) {
    score -= 25;
    findings.push({
      code: "no_booking_engine",
      severity: "high",
      description:
        "No direct booking engine detected. Every booking routes through OTAs — paying 15-20% commission.",
    });
    fixes.push(
      "Install a direct booking widget (Lodgify, Smoobu, Hostaway, Beds24) — recover OTA commission."
    );
  }
  if (!has_multilingual) {
    score -= 5;
    findings.push({
      code: "single_language",
      severity: "low",
      description: "Only one language — limits reach to international guests.",
    });
    fixes.push("Add at least an English version using <link rel=alternate hreflang>.");
  }
  // FR domain + English-only is a specific weird signal
  const isFrDomain = /\.fr(\/|$)/i.test(url);
  const onlyEnglish = uniqueLangs.length === 1 && /^en/.test(uniqueLangs[0]);
  if (isFrDomain && onlyEnglish) {
    score -= 8;
    findings.push({
      code: "fr_domain_english_only",
      severity: "medium",
      description:
        ".fr domain but English-only content. Either missing the local French market or mistargeted.",
    });
  }
  if (!has_analytics) {
    score -= 5;
    findings.push({
      code: "no_analytics",
      severity: "low",
      description: "No analytics detected — can't measure conversion or marketing ROI.",
    });
    fixes.push("Install GA4 or Plausible.");
  }
  if (!has_pixel && has_analytics) {
    score -= 3;
    findings.push({
      code: "no_retargeting",
      severity: "low",
      description: "Analytics but no retargeting pixel — leaving abandoned bookings unrecoverable.",
    });
    fixes.push("Add a Meta Pixel or LinkedIn Insight Tag for retargeting abandoned bookings.");
  }
  if (!has_newsletter_capture) {
    score -= 5;
    findings.push({
      code: "no_email_capture",
      severity: "medium",
      description: "No email capture form — every visitor who doesn't book is lost.",
    });
    fixes.push("Add a newsletter signup with a small incentive (10% off direct, late check-in, etc.).");
  }
  if (copyright_stale && copyright_year) {
    score -= 6;
    findings.push({
      code: "stale_copyright",
      severity: "medium",
      description: `Copyright footer reads ${copyright_year} — visitors infer the site is abandoned.`,
    });
    fixes.push(`Update the footer copyright to ${currentYear}.`);
  }
  if (!has_reviews_widget) {
    score -= 5;
    findings.push({
      code: "no_reviews_widget",
      severity: "low",
      description: "No public reviews widget on homepage — trust friction at the moment of decision.",
    });
    fixes.push("Embed Google reviews or Trustpilot widget above the fold.");
  }
  if (!has_legal_link) {
    score -= 4;
    findings.push({
      code: "no_legal_link",
      severity: "low",
      description:
        "No mentions légales / privacy link found in footer — GDPR exposure for the operator.",
    });
    fixes.push("Add a /mentions-legales and /politique-de-confidentialite page.");
  }
  if (html_bytes > 1_500_000) {
    score -= 6;
    findings.push({
      code: "heavy_page",
      severity: "medium",
      description: `Homepage HTML weighs ${(html_bytes / 1024).toFixed(0)} KB — slow on mobile, hurts SEO.`,
    });
    fixes.push("Compress homepage HTML, defer non-critical JS, lazy-load images.");
  }
  if (fetch_ms > 3000) {
    score -= 6;
    findings.push({
      code: "slow_ttfb",
      severity: "medium",
      description: `Time to first byte ${fetch_ms}ms — server is slow to respond.`,
    });
    fixes.push("Enable HTTP caching / CDN (Cloudflare, Vercel Edge) in front of the origin.");
  }
  if (image_count > 0 && image_count < 6) {
    score -= 3;
    findings.push({
      code: "few_images",
      severity: "low",
      description: `Only ${image_count} images on homepage — vacation rentals sell visually.`,
    });
    fixes.push("Add a hero gallery with at least 8-10 high-quality property photos.");
  }

  score = Math.max(0, Math.min(100, score));

  const signals: WebsiteAudit["signals"] = {
    has_viewport_meta,
    has_schema_jsonld,
    schema_types,
    has_booking_engine,
    booking_engine,
    has_multilingual,
    detected_languages: uniqueLangs,
    has_analytics,
    analytics_vendors,
    has_pixel,
    has_mailto,
    has_newsletter_capture,
    copyright_year,
    copyright_stale,
    has_reviews_widget,
    has_legal_link,
    image_count,
    title,
    description,
  };

  // ── Lost-revenue hypothesis + outreach snippet via Mammouth ────────────────
  let lost_revenue_hypothesis: string | undefined;
  let outreach_snippet: string | undefined;

  if (opts.generate_outreach && Mammouth.isConfigured() && findings.length > 0) {
    try {
      const ranked = findings.filter((f) => f.severity !== "low").slice(0, 6);
      const prompt = `Property website audit findings for ${title ?? url}:
${ranked.map((f, i) => `${i + 1}. [${f.severity}] ${f.description}`).join("\n")}

Write TWO things in JSON:
1. lost_revenue_hypothesis: one sentence estimating *why* this site is leaving money on the table. Be concrete, name the missing capability.
2. outreach_snippet: a 2-3 sentence opening line of an email to the operator. Lead with one specific observation from the audit. Offer a free quick audit. Never reveal mass scanning. No tracking language. End with a soft CTA.

JSON: { "lost_revenue_hypothesis": string, "outreach_snippet": string }`;
      const out = await Mammouth.reason<{
        lost_revenue_hypothesis?: string;
        outreach_snippet?: string;
      }>(
        "You are a B2B revenue consultant for vacation-rental operators. Be concrete, no fluff, no creep factor.",
        prompt
      );
      lost_revenue_hypothesis = out?.lost_revenue_hypothesis;
      outreach_snippet = out?.outreach_snippet;
    } catch (err) {
      console.error(
        "[WebsiteAuditor] outreach generation failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    url,
    fetched: true,
    status_code,
    fetch_ms,
    html_bytes,
    audit_score: score,
    findings,
    signals,
    lost_revenue_hypothesis,
    recommended_fixes: fixes,
    outreach_snippet,
  };
}

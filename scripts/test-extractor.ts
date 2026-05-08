/**
 * Test script: crawl a real website and show extracted contacts.
 * Usage: npx tsx scripts/test-extractor.ts [url]
 * Default URL: https://www.biarritz-conciergerie.com (a real STR concierge)
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

// Minimal SSRF validation inline (avoids Next.js module resolution issues)
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
  } catch {
    return false;
  }
}

async function fetchPage(url: string): Promise<string | null> {
  if (!isPublicUrl(url)) {
    console.warn(`  Skipped (SSRF blocked): ${url}`);
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ProspectBot/1.0)",
        Accept: "text/html",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractEmails(html: string): string[] {
  const found = new Set<string>();
  const mailtoMatches = html.matchAll(/href="mailto:([^"?]+)/gi);
  for (const m of mailtoMatches) found.add(m[1].trim().toLowerCase());
  const regexMatches = html.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
  for (const m of regexMatches) {
    const e = m[0].toLowerCase();
    if (!e.endsWith(".png") && !e.endsWith(".jpg") && e.length < 100) found.add(e);
  }
  return Array.from(found);
}

function extractPhones(html: string): string[] {
  const found = new Set<string>();
  const telMatches = html.matchAll(/href="tel:([^"]+)"/gi);
  for (const m of telMatches) found.add(m[1].trim());
  return Array.from(found);
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

(async () => {
  const targetUrl = process.argv[2] ?? "https://www.guidigo.com";
  console.log(`Contact Extractor Test`);
  console.log(`======================`);
  console.log(`URL: ${targetUrl}\n`);

  if (!isPublicUrl(targetUrl)) {
    console.error("❌ URL blocked by SSRF validation");
    process.exit(1);
  }

  const CONTACT_PATHS = ["/contact", "/contactez-nous", "/about", "/a-propos"];
  const origin = new URL(targetUrl).origin;
  const urls = [targetUrl, ...CONTACT_PATHS.map((p) => `${origin}${p}`)];

  const allEmails: string[] = [];
  const allPhones: string[] = [];
  let title: string | null = null;
  let pagesChecked = 0;

  for (const url of urls) {
    process.stdout.write(`  Fetching ${url} ... `);
    const html = await fetchPage(url);
    if (!html) {
      console.log("no response");
      continue;
    }
    pagesChecked++;
    console.log(`${html.length} bytes`);

    const emails = extractEmails(html);
    const phones = extractPhones(html);
    if (!title) title = extractTitle(html);

    allEmails.push(...emails);
    allPhones.push(...phones);
  }

  const uniqueEmails = [...new Set(allEmails)];
  const uniquePhones = [...new Set(allPhones)];

  console.log(`\n── Results ─────────────────────────────────────────`);
  console.log(`Pages checked: ${pagesChecked}`);
  console.log(`Page title:    ${title ?? "(none)"}`);
  console.log(`Emails found:  ${uniqueEmails.length > 0 ? uniqueEmails.join(", ") : "(none)"}`);
  console.log(`Phones found:  ${uniquePhones.length > 0 ? uniquePhones.join(", ") : "(none)"}`);

  const hasContact = uniqueEmails.length > 0 || uniquePhones.length > 0;
  console.log(`\n${hasContact ? "✅ Contact info found" : "⚠️  No contact info found (normal for some sites)"}`);
})();

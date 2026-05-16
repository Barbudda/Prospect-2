/**
 * Smoke script: exercise the real contact-extractor against international
 * STR sites. Prints what phones + emails each one yielded so we can spot
 * gaps in worldwide coverage.
 *
 * Usage: npx tsx scripts/smoke-international.ts
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const SITES: Array<{ country: string; url: string }> = [
  // France
  { country: "FR", url: "https://www.biarritz-conciergerie.com" },
  { country: "FR", url: "https://www.guestready.com/fr/" },
  // United Kingdom
  { country: "GB", url: "https://www.hostmaker.com" },
  { country: "GB", url: "https://www.airsorted.uk" },
  // Germany
  { country: "DE", url: "https://www.gastfreund.net" },
  // Spain
  { country: "ES", url: "https://www.helloapartments.com" },
  // Italy
  { country: "IT", url: "https://www.holidu.it" },
  // United States
  { country: "US", url: "https://www.evolve.com" },
];

(async () => {
  // Lazy import so dotenv loads first.
  const { extractContactsFromWebsite } = await import("@/lib/engines/contact-extractor");
  for (const site of SITES) {
    console.log(`\n══ ${site.country} ${site.url} ════════════════════════`);
    const t0 = Date.now();
    try {
      const result = await extractContactsFromWebsite(site.url, {
        maxPages: 5,
        timeoutMs: 8_000,
      });
      const elapsed = Date.now() - t0;
      if (!result) {
        console.log(`  ✗ extractor returned null (SSRF or fetch failure) in ${elapsed}ms`);
        continue;
      }
      console.log(`  ⏱  ${elapsed}ms`);
      console.log(`  📞 phones (${result.phones.length}):`);
      for (const p of result.phones) {
        console.log(`     ${p.normalized ?? p.raw}  (raw=${p.raw}, conf=${p.confidence})  ←  ${p.source}`);
      }
      console.log(`  ✉️  emails (${result.emails.length}):`);
      for (const e of result.emails) {
        console.log(`     ${e.value}  (conf=${e.confidence})  ←  ${e.source}`);
      }
      console.log(`  🏷  company: ${result.company_name ?? "(none)"}`);
    } catch (err) {
      console.log(`  ✗ threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
})();

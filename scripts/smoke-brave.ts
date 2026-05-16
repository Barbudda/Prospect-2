/**
 * Smoke script: verify Brave Search is configured and returns real results.
 * Usage: npx tsx scripts/smoke-brave.ts
 * Requires: BRAVE_SEARCH_API_KEY in .env.local
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const API_KEY = process.env.BRAVE_SEARCH_API_KEY;

if (!API_KEY) {
  console.error("❌ BRAVE_SEARCH_API_KEY not set in .env.local");
  process.exit(1);
}

async function testSearch() {
  console.log("\n── Brave Web Search ────────────────────────────────");
  const params = new URLSearchParams({
    q: "conciergerie Airbnb Biarritz",
    count: "5",
    country: "FR",
    search_lang: "fr",
    safesearch: "moderate",
  });

  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": API_KEY!,
      },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ HTTP ${res.status}: ${body}`);
    return false;
  }

  const data = await res.json();
  const results = data.web?.results ?? [];
  console.log(`✅ ${results.length} results returned`);

  for (const r of results.slice(0, 3)) {
    console.log(`   - ${r.title}`);
    console.log(`     ${r.url}`);
  }
  return true;
}

(async () => {
  console.log("Brave Search Test — Biarritz, France");
  console.log("=====================================");

  let ok = true;
  try {
    ok = await testSearch();
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
  }

  console.log(`\n${ok ? "✅ All tests passed" : "❌ Some tests failed"}`);
  process.exit(ok ? 0 : 1);
})();

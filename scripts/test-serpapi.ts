/**
 * Test script: verify SerpAPI is configured and returns real results.
 * Usage: npx tsx scripts/test-serpapi.ts
 * Requires: SERPAPI_API_KEY in .env.local
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const API_KEY = process.env.SERPAPI_API_KEY;

if (!API_KEY) {
  console.error("❌ SERPAPI_API_KEY not set in .env.local");
  process.exit(1);
}

async function testWebSearch() {
  console.log("\n── Web Search ──────────────────────────────────────");
  const params = new URLSearchParams({
    api_key: API_KEY!,
    engine: "google",
    q: "conciergerie Airbnb Biarritz",
    gl: "fr",
    hl: "fr",
    num: "5",
  });

  const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ HTTP ${res.status}: ${body}`);
    return false;
  }

  const data = await res.json();
  const results = data.organic_results ?? [];
  console.log(`✅ ${results.length} organic results returned`);

  for (const r of results.slice(0, 3)) {
    console.log(`   - ${r.title}`);
    console.log(`     ${r.link}`);
  }
  return true;
}

async function testMapsSearch() {
  console.log("\n── Google Maps Search ─────────────────────────────");
  const params = new URLSearchParams({
    api_key: API_KEY!,
    engine: "google_maps",
    q: "conciergerie Airbnb Biarritz France",
    type: "search",
  });

  const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ HTTP ${res.status}: ${body}`);
    return false;
  }

  const data = await res.json();
  const results = data.local_results ?? [];
  console.log(`✅ ${results.length} local results returned`);

  for (const r of results.slice(0, 3)) {
    console.log(`   - ${r.title}`);
    if (r.website) console.log(`     Website: ${r.website}`);
    if (r.phone) console.log(`     Phone: ${r.phone}`);
  }
  return true;
}

(async () => {
  console.log("SerpAPI Test — Biarritz, France");
  console.log("================================");

  let ok = true;
  try {
    ok = await testWebSearch() && ok;
    await new Promise((r) => setTimeout(r, 1000));
    ok = await testMapsSearch() && ok;
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
  }

  console.log(`\n${ok ? "✅ All tests passed" : "❌ Some tests failed"}`);
  process.exit(ok ? 0 : 1);
})();

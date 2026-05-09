/**
 * ship.mjs — push to GitHub, deploy to Vercel, smoke-test the production API.
 * Usage: node scripts/ship.mjs [optional commit message]
 */
import { execSync } from "child_process";

const msg = process.argv[2] ?? "chore: auto-ship";
const BASE = "https://prospect-2.vercel.app";

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

// ── 1. Git push ──────────────────────────────────────────────────────────────
console.log("\n=== 1. Pushing to GitHub ===");
run("git add -A");
try {
  run(`git commit -m "${msg}"`);
} catch {
  console.log("Nothing to commit.");
}
run("git push origin master");

// ── 2. Deploy to Vercel ──────────────────────────────────────────────────────
console.log("\n=== 2. Deploying to Vercel ===");
run("vercel --prod --yes");

// ── 3. Smoke test ────────────────────────────────────────────────────────────
console.log("\n=== 3. Smoke testing production ===");

async function test(path, expectedStatus) {
  const r = await fetch(BASE + path);
  const ok = r.status === expectedStatus;
  console.log(`${ok ? "✓" : "✗"} ${path} → ${r.status} (expected ${expectedStatus})`);
  if (!ok) {
    const body = await r.text();
    console.log("   Body:", body.slice(0, 200));
  }
  return ok;
}

const results = await Promise.all([
  test("/login", 200),
  test("/api/stats", 401),
  test("/api/runs", 401),
  test("/api/providers/status", 401),
]);

const pass = results.every(Boolean);
console.log(pass ? "\n✓ All checks passed." : "\n✗ Some checks failed.");
process.exit(pass ? 0 : 1);

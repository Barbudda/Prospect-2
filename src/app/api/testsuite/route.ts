// TEMPORARY TEST ENDPOINT — delete after testing session
// Protected by x-test-key header

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const TEST_KEY = "prospect-test-2026-may";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-test-key") !== TEST_KEY) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServiceClient();
  const results: Record<string, unknown> = {};

  // ── 1. Env vars ─────────────────────────────────────────────────────────────
  results.env = {
    supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/https:\/\//, "").split(".")[0] ?? "MISSING",
    mammouth: !!process.env.MAMMOUTH_API_KEY,
    mammouth_url: process.env.MAMMOUTH_BASE_URL ?? "MISSING",
    mammouth_model: process.env.MAMMOUTH_CHAT_MODEL ?? "MISSING",
    google_vision: !!process.env.GOOGLE_VISION_API_KEY,
    google_places: !!process.env.GOOGLE_PLACES_API_KEY,
    serpapi: !!process.env.SERPAPI_API_KEY,
    pappers: !!process.env.PAPPERS_API_KEY,
    dropcontact: !!process.env.DROPCONTACT_API_KEY,
    service_role_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    postgres_url_set: !!process.env.POSTGRES_URL,
  };

  // ── 2. Database connectivity ─────────────────────────────────────────────────
  try {
    const { count, error } = await supabase.from("leads").select("id", { count: "exact", head: true });
    results.db_leads = { count, error: error?.message ?? null };
  } catch (e) { results.db_leads = { error: String(e) }; }

  try {
    const { count, error } = await supabase.from("search_runs").select("id", { count: "exact", head: true });
    results.db_runs = { count, error: error?.message ?? null };
  } catch (e) { results.db_runs = { error: String(e) }; }

  // ── 3. Auth — get user + sign in ─────────────────────────────────────────────
  try {
    const { data: listData, error: listErr } = await supabase.auth.admin.listUsers();
    results.auth_users = {
      count: listData?.users?.length ?? 0,
      emails: listData?.users?.map((u) => u.email) ?? [],
      error: listErr?.message ?? null,
    };
  } catch (e) { results.auth_users = { error: String(e) }; }

  // Sign in to get access token for further testing
  try {
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email: "hugo8.m@outlook.fr",
      password: "Biboutitou74!!",
    });
    results.auth_signin = {
      success: !signInErr,
      user_id: signInData?.user?.id ?? null,
      access_token: signInData?.session?.access_token ?? null,
      error: signInErr?.message ?? null,
    };
  } catch (e) { results.auth_signin = { error: String(e) }; }

  // ── 4. Recent leads sample ───────────────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from("leads")
      .select("id, primary_name, city, score, phone, email, source_type, website_url, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    results.leads_sample = { data, error: error?.message ?? null };
  } catch (e) { results.leads_sample = { error: String(e) }; }

  // ── 5. Runs sample ───────────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from("search_runs")
      .select("id, city, status, progress, created_at, finished_at")
      .order("created_at", { ascending: false })
      .limit(10);
    results.runs_sample = { data, error: error?.message ?? null };
  } catch (e) { results.runs_sample = { error: String(e) }; }

  // ── 6. Stuck run check ───────────────────────────────────────────────────────
  try {
    const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const { data, error } = await supabase
      .from("search_runs")
      .select("id, city, status, created_at")
      .in("status", ["running", "reconstructing", "queued"])
      .lt("created_at", stuckThreshold);
    results.stuck_runs = { data, error: error?.message ?? null };
  } catch (e) { results.stuck_runs = { error: String(e) }; }

  // ── 7. Mammouth — real completion ping ──────────────────────────────────────
  try {
    const key = process.env.MAMMOUTH_API_KEY;
    const base = process.env.MAMMOUTH_BASE_URL;
    const model = process.env.MAMMOUTH_CHAT_MODEL ?? "gpt-4o";
    if (!key || !base) {
      results.mammouth_ping = { error: "Not configured" };
    } else {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with exactly: PONG" }],
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = { raw: text.slice(0, 200) }; }
      results.mammouth_ping = {
        status: res.status,
        ok: res.ok,
        model,
        reply: (json as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? null,
        error: res.ok ? null : (json.error ?? text.slice(0, 200)),
      };
    }
  } catch (e) { results.mammouth_ping = { error: String(e) }; }

  // ── 8. SerpAPI account check ─────────────────────────────────────────────────
  try {
    const key = process.env.SERPAPI_API_KEY;
    if (!key) {
      results.serpapi_ping = { error: "Not configured" };
    } else {
      const res = await fetch(`https://serpapi.com/account?api_key=${key}`, {
        signal: AbortSignal.timeout(8_000),
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = { raw: text.slice(0, 200) }; }
      results.serpapi_ping = {
        status: res.status,
        plan_searches_left: json.plan_searches_left ?? json.searches_left ?? null,
        account_email: json.email ?? null,
        error: res.ok ? null : json,
      };
    }
  } catch (e) { results.serpapi_ping = { error: String(e) }; }

  // ── 9. Google Vision ─────────────────────────────────────────────────────────
  try {
    const key = process.env.GOOGLE_VISION_API_KEY;
    if (!key) {
      results.vision_ping = { error: "Not configured" };
    } else {
      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requests: [] }),
          signal: AbortSignal.timeout(8_000),
        }
      );
      results.vision_ping = { status: res.status, ok: res.ok };
    }
  } catch (e) { results.vision_ping = { error: String(e) }; }

  // ── 10. Google Places ────────────────────────────────────────────────────────
  try {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) {
      results.places_ping = { error: "Not configured" };
    } else {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=48.8566,2.3522&radius=100&type=lodging&key=${key}`,
        { signal: AbortSignal.timeout(8_000) }
      );
      const json = await res.json() as Record<string, unknown>;
      results.places_ping = {
        status: res.status,
        api_status: json.status,
        results_count: Array.isArray(json.results) ? json.results.length : 0,
      };
    }
  } catch (e) { results.places_ping = { error: String(e) }; }

  // ── 11. Pappers check ────────────────────────────────────────────────────────
  try {
    const key = process.env.PAPPERS_API_KEY;
    if (!key) {
      results.pappers_ping = { error: "Not configured" };
    } else {
      const res = await fetch(
        `https://api.pappers.fr/v2/entreprise?siren=552032534&api_token=${key}`,
        { signal: AbortSignal.timeout(8_000) }
      );
      const json = await res.json() as Record<string, unknown>;
      results.pappers_ping = { status: res.status, nom: json.nom_entreprise ?? json.error ?? null };
    }
  } catch (e) { results.pappers_ping = { error: String(e) }; }

  // ── 12. Fix stuck runs ───────────────────────────────────────────────────────
  try {
    const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: fixed, error } = await supabase
      .from("search_runs")
      .update({ status: "failed", error_message: "Run timed out — marked failed by health check" })
      .in("status", ["running", "reconstructing", "queued"])
      .lt("created_at", stuckThreshold)
      .select("id, city");
    results.fix_stuck_runs = { fixed: fixed?.length ?? 0, ids: fixed?.map((r) => `${r.city} (${r.id})`), error: error?.message ?? null };
  } catch (e) { results.fix_stuck_runs = { error: String(e) }; }

  return NextResponse.json(results, { status: 200 });
}

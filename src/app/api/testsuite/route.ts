// TEMPORARY TEST ENDPOINT — delete after testing session
// Protected by x-test-key header

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

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

  try {
    const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true });
    results.db_profiles = { count, error: error?.message ?? null };
  } catch (e) { results.db_profiles = { error: String(e) }; }

  // ── 3. Auth — create user ────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email: "hugo8.m@outlook.fr",
      password: "Biboutitou74!!",
      email_confirm: true,
    });
    results.auth_create = {
      success: !error,
      user_id: data?.user?.id ?? null,
      error: error?.message ?? null,
    };
  } catch (e) { results.auth_create = { error: String(e) }; }

  // ── 4. List existing users ───────────────────────────────────────────────────
  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    results.auth_users = {
      count: data?.users?.length ?? 0,
      emails: data?.users?.map((u) => u.email) ?? [],
      error: error?.message ?? null,
    };
  } catch (e) { results.auth_users = { error: String(e) }; }

  // ── 5. Existing leads sample ──────────────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from("leads")
      .select("id, primary_name, city, score, phone, email, source_type, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    results.leads_sample = { data, error: error?.message ?? null };
  } catch (e) { results.leads_sample = { error: String(e) }; }

  // ── 6. Existing runs ──────────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from("search_runs")
      .select("id, city, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    results.runs_sample = { data, error: error?.message ?? null };
  } catch (e) { results.runs_sample = { error: String(e) }; }

  // ── 7. Mammouth connectivity ─────────────────────────────────────────────────
  try {
    const key = process.env.MAMMOUTH_API_KEY;
    const base = process.env.MAMMOUTH_BASE_URL;
    if (!key || !base) {
      results.mammouth_ping = { error: "API key or base URL not configured" };
    } else {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8_000),
      });
      const json = await res.json() as Record<string, unknown>;
      results.mammouth_ping = { status: res.status, models_count: Array.isArray(json.data) ? json.data.length : "N/A" };
    }
  } catch (e) { results.mammouth_ping = { error: String(e) }; }

  // ── 8. SerpAPI connectivity ──────────────────────────────────────────────────
  try {
    const key = process.env.SERPAPI_API_KEY;
    if (!key) {
      results.serpapi_ping = { error: "Not configured" };
    } else {
      const res = await fetch(`https://serpapi.com/account?api_key=${key}`, {
        signal: AbortSignal.timeout(8_000),
      });
      const json = await res.json() as Record<string, unknown>;
      results.serpapi_ping = {
        status: res.status,
        account_email: json.email ?? null,
        searches_left: json.searches_left ?? null,
        error: res.ok ? null : json.error,
      };
    }
  } catch (e) { results.serpapi_ping = { error: String(e) }; }

  // ── 9. Google Vision connectivity ────────────────────────────────────────────
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

  // ── 10. Google Places connectivity ───────────────────────────────────────────
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
      results.places_ping = { status: res.status, api_status: json.status, results_count: Array.isArray(json.results) ? json.results.length : 0 };
    }
  } catch (e) { results.places_ping = { error: String(e) }; }

  return NextResponse.json(results, { status: 200 });
}

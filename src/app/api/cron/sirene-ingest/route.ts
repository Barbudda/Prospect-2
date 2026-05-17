// GET /api/cron/sirene-ingest
//
// Weekly Vercel Cron (Mondays 04:00 UTC). For each unique (user_id, city)
// pair in the `leads` table, pulls fresh STR-relevant entries from the
// French Recherche Entreprises API (auto-entrepreneurs registered with
// NAF 5520Z = furnished short-term lets, or 6820A = residential rental).
//
// Authorisation: Vercel cron requests carry the
// `Authorization: Bearer <CRON_SECRET>` header when CRON_SECRET is set.
// If CRON_SECRET is unset (local dev) the route runs without auth.
//
// Source: https://recherche-entreprises.api.gouv.fr/ — open data, Etalab
// 2.0 license. No API key, no rate limit beyond fair-use.
//
// Each new SIRENE row that doesn't already correspond to an existing lead
// for that user is inserted as a draft lead with source_type
// `sirene_weekly_ingest`. Quality gate + suppression list are honoured
// at insert time.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { gradeLead } from "@/lib/engines/lead-quality-gate";
import { loadSuppressionSet, isSuppressed } from "@/lib/utils/suppression";
import { validatePhone } from "@/lib/utils/contact-validator";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // weekly: be generous

const NAF_CODES = ["5520Z", "6820A"];
const PER_CITY_LIMIT = 25;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface EntrepriseHit {
  nom_complet?: string;
  siege?: {
    siret?: string;
    telephone?: string;
    adresse?: string;
    code_postal?: string;
    commune?: string;
    latitude?: number;
    longitude?: number;
  };
  activite_principale?: string;
  nature_juridique?: string;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startedAt = Date.now();
  const service = createServiceClient();

  // Find every (user, city) the orchestrator has touched. SIRENE is keyed
  // by commune, so we focus on the cities where the user actually operates.
  const { data: cityRows, error: cityErr } = await service
    .from("leads")
    .select("user_id, city")
    .not("city", "is", null)
    .limit(2000);

  if (cityErr) {
    console.error("[cron sirene] city query failed:", cityErr.message);
    return NextResponse.json({ error: cityErr.message }, { status: 500 });
  }

  // Build a unique (user_id, city) set.
  const targets = new Map<string, { user_id: string; city: string }>();
  for (const row of cityRows ?? []) {
    if (!row.user_id || !row.city) continue;
    const key = `${row.user_id}|${row.city.toLowerCase().trim()}`;
    if (!targets.has(key)) targets.set(key, { user_id: row.user_id, city: row.city });
  }

  let inserted = 0;
  let skippedDup = 0;
  let skippedGate = 0;
  let skippedDnc = 0;
  let fetched = 0;
  const perTargetSummary: Array<{
    user_id: string;
    city: string;
    fetched: number;
    inserted: number;
  }> = [];

  for (const target of targets.values()) {
    if (Date.now() - startedAt > 240_000) break; // leave headroom for the response

    let cityFetched = 0;
    let cityInserted = 0;

    // Pre-load the user's suppression list once per target.
    const suppressed = await loadSuppressionSet(service, target.user_id);

    for (const naf of NAF_CODES) {
      try {
        const params = new URLSearchParams({
          per_page: String(PER_CITY_LIMIT),
          activite_principale: naf,
          commune: target.city,
        });
        const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?${params}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { results?: EntrepriseHit[] };
        const hits = data.results ?? [];
        cityFetched += hits.length;
        fetched += hits.length;

        // Pull existing SIRETs for this user to dedupe.
        const sirets = hits
          .map((h) => h.siege?.siret)
          .filter((s): s is string => Boolean(s));
        if (sirets.length === 0) continue;

        const { data: existingRows } = await service
          .from("leads")
          .select("source_url")
          .eq("user_id", target.user_id)
          .in(
            "source_url",
            sirets.map((s) => `https://annuaire-entreprises.data.gouv.fr/entreprise/${s}`)
          );
        const existingUrls = new Set(
          (existingRows ?? []).map((r) => r.source_url as string)
        );

        for (const hit of hits) {
          const siret = hit.siege?.siret;
          if (!siret) continue;
          const sourceUrl = `https://annuaire-entreprises.data.gouv.fr/entreprise/${siret}`;
          if (existingUrls.has(sourceUrl)) {
            skippedDup++;
            continue;
          }

          const phoneE164 = hit.siege?.telephone
            ? validatePhone(hit.siege.telephone, "FR").e164 ?? null
            : null;

          const partial = {
            primary_name: hit.nom_complet ?? `SIRET ${siret}`,
            company_name: hit.nom_complet ?? null,
            lead_type:
              naf === "5520Z" ? "Gîte / Villa Operator" : "Direct Booking Owner",
            city: target.city,
            country: "France",
            address: hit.siege?.adresse ?? null,
            phone: phoneE164,
            source_url: sourceUrl,
            source_type: "sirene_weekly_ingest",
          };

          const verdict = gradeLead(partial);
          if (!verdict.keep) {
            skippedGate++;
            continue;
          }
          const sup = isSuppressed(suppressed, { phone: phoneE164 });
          if (sup.suppressed) {
            skippedDnc++;
            continue;
          }

          const { error: insErr } = await service.from("leads").insert({
            user_id: target.user_id,
            ...partial,
            quality_summary: `Auto-discovered weekly via Recherche Entreprises (NAF ${naf}, commune ${target.city}). SIRET ${siret}.`,
            confidence: phoneE164 ? "high" : "medium",
            status: "new",
            outreach_status: "not_contacted",
            score: phoneE164 ? 70 : 55,
            score_label: phoneE164 ? "Good" : "Medium",
          });
          if (insErr) {
            console.warn("[cron sirene] insert failed:", insErr.message);
            continue;
          }
          cityInserted++;
          inserted++;
        }
        await sleep(250); // be polite to data.gouv.fr
      } catch (err) {
        console.warn(
          `[cron sirene] target ${target.user_id}/${target.city} NAF ${naf} failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    perTargetSummary.push({
      user_id: target.user_id,
      city: target.city,
      fetched: cityFetched,
      inserted: cityInserted,
    });
  }

  return NextResponse.json({
    ok: true,
    elapsed_ms: Date.now() - startedAt,
    targets: targets.size,
    fetched,
    inserted,
    skipped_duplicate: skippedDup,
    skipped_quality_gate: skippedGate,
    skipped_dnc: skippedDnc,
    per_target: perTargetSummary,
  });
}

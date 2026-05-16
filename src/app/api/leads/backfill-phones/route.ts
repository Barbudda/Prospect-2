// POST /api/leads/backfill-phones
// For every lead that has a website_url but no phone, crawls the website
// (with the corrected +33-(0)X regex) and saves the first validated phone.
// One-shot backfill — call once to fix existing leads.
//
// Runtime shape: Vercel kills the handler at `maxDuration` seconds, so the
// route enforces its own elapsed-time budget and returns partial results
// before that hard kill. Each lead's crawl is capped tightly (3 pages,
// 7s per page → ~21s worst case) so a single slow host can't burn the
// entire budget on its own.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { extractContactsFromWebsite } from "@/lib/engines/contact-extractor";
import { validateFrenchPhone } from "@/lib/utils/contact-validator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Budget settings — keep these in sync with maxDuration above.
const TOTAL_BUDGET_MS = 52_000;      // leave ~8s headroom for response serialisation
const PER_LEAD_MAX_PAGES = 3;
const PER_LEAD_PAGE_TIMEOUT_MS = 7_000;
const DEFAULT_LIMIT = 10;
const HARD_LIMIT = 25;
const INTER_LEAD_SLEEP_MS = 120;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Reason =
  | "phone_saved"
  | "no_phone_on_site"
  | "site_unreachable"
  | "ssrf_blocked"
  | "validator_rejected"
  | "db_update_failed"
  | "budget_exhausted";

interface LeadDetail {
  lead_id: string;
  name: string;
  website: string;
  phone_found: string | null;
  updated: boolean;
  reason: Reason;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { limit?: number; dry_run?: boolean };
    const limit = Math.min(Math.max(1, body.limit ?? DEFAULT_LIMIT), HARD_LIMIT);
    const dryRun = body.dry_run === true;

    // Pull candidates: lead has website_url but no phone, not opted out
    const { data: candidates, error } = await supabase
      .from("leads")
      .select("id, primary_name, city, website_url, phone, outreach_status")
      .eq("user_id", user.id)
      .not("website_url", "is", null)
      .is("phone", null)
      .neq("outreach_status", "opted_out")
      .neq("outreach_status", "unsubscribed")
      .order("score", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!candidates || candidates.length === 0)
      return NextResponse.json({
        scanned: 0,
        processed: 0,
        phones_found: 0,
        leads_updated: 0,
        details: [],
        elapsed_ms: elapsed(),
        info: "No leads with website-but-no-phone to backfill.",
      });

    const service = createServiceClient();
    const details: LeadDetail[] = [];
    let processed = 0;
    let bailedEarly = false;

    for (const lead of candidates) {
      // Before starting a new lead's crawl, make sure we have enough budget
      // left for ~one full worst-case crawl plus DB writes. If not, stop
      // and return what we have so far.
      const remaining = TOTAL_BUDGET_MS - elapsed();
      const reservePerLead = PER_LEAD_MAX_PAGES * PER_LEAD_PAGE_TIMEOUT_MS + 2_000;
      if (remaining < reservePerLead) {
        bailedEarly = true;
        // Record the un-processed leads as "budget_exhausted" so the UI can
        // show what was skipped and the user can press the button again.
        details.push({
          lead_id: lead.id,
          name: lead.primary_name,
          website: lead.website_url!,
          phone_found: null,
          updated: false,
          reason: "budget_exhausted",
        });
        continue;
      }

      processed++;
      let phoneFound: string | null = null;
      let reason: Reason = "no_phone_on_site";

      try {
        const contacts = await extractContactsFromWebsite(lead.website_url!, {
          maxPages: PER_LEAD_MAX_PAGES,
          timeoutMs: PER_LEAD_PAGE_TIMEOUT_MS,
        });

        if (contacts === null) {
          reason = "ssrf_blocked";
        } else {
          const phones = contacts.phones ?? [];
          if (phones.length === 0) {
            reason = "no_phone_on_site";
          } else {
            // Try each extracted phone through the strict validator. Take
            // the first one that passes.
            let validatorPassed = false;
            for (const p of phones) {
              const v1 = p.normalized ? validateFrenchPhone(p.normalized) : null;
              const v2 = validateFrenchPhone(p.raw);
              if (v1?.valid && v1.cleaned) {
                phoneFound = v1.cleaned;
                validatorPassed = true;
                break;
              }
              if (v2.valid && v2.cleaned) {
                phoneFound = v2.cleaned;
                validatorPassed = true;
                break;
              }
            }
            if (!validatorPassed) reason = "validator_rejected";
          }
        }
      } catch (crawlErr) {
        reason = "site_unreachable";
        console.warn(
          `[backfill-phones] crawl failed for lead ${lead.id} (${lead.website_url}):`,
          crawlErr instanceof Error ? crawlErr.message : crawlErr
        );
      }

      let updated = false;
      if (phoneFound && !dryRun) {
        const { error: updErr } = await service
          .from("leads")
          .update({ phone: phoneFound, updated_at: new Date().toISOString() })
          .eq("id", lead.id)
          .eq("user_id", user.id);
        if (updErr) {
          reason = "db_update_failed";
          console.error(`[backfill-phones] DB update failed for lead ${lead.id}:`, updErr.message);
        } else {
          updated = true;
          reason = "phone_saved";
          // Fire-and-forget audit log; missing table or RLS reject must not
          // turn a successful phone backfill into a route error.
          service
            .from("lead_enrichment_events")
            .insert({
              lead_id: lead.id,
              provider: "phone_backfill",
              status: "success",
              error_message: `Backfilled phone from ${lead.website_url}: ${phoneFound}`,
            })
            .then(() => undefined, () => undefined);
        }
      } else if (phoneFound && dryRun) {
        reason = "phone_saved"; // would-have-saved
      }

      details.push({
        lead_id: lead.id,
        name: lead.primary_name,
        website: lead.website_url!,
        phone_found: phoneFound,
        updated,
        reason,
      });

      await sleep(INTER_LEAD_SLEEP_MS);
    }

    const phonesFound = details.filter((d) => d.phone_found).length;
    const leadsUpdated = details.filter((d) => d.updated).length;
    const skipped = details.filter((d) => d.reason === "budget_exhausted").length;

    return NextResponse.json({
      scanned: candidates.length,
      processed,
      phones_found: phonesFound,
      leads_updated: leadsUpdated,
      skipped_budget: skipped,
      bailed_early: bailedEarly,
      dry_run: dryRun,
      elapsed_ms: elapsed(),
      details,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/backfill-phones]", message);
    return NextResponse.json(
      { error: message, elapsed_ms: elapsed() },
      { status: 500 }
    );
  }
}

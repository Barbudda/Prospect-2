// POST /api/leads/backfill-phones
// For every lead that has a website_url but no phone, crawls the website
// (with the corrected +33-(0)X regex) and saves the first validated phone.
// One-shot backfill — call once to fix existing leads.

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { extractContactsFromWebsite } from "@/lib/engines/contact-extractor";
import { validateFrenchPhone } from "@/lib/utils/contact-validator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { limit?: number; dry_run?: boolean };
    const limit = Math.min(Math.max(1, body.limit ?? 25), 50);
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
        phones_found: 0,
        leads_updated: 0,
        details: [],
        info: "No leads with website-but-no-phone to backfill.",
      });

    const service = createServiceClient();
    const details: Array<{
      lead_id: string;
      name: string;
      website: string;
      phone_found: string | null;
      updated: boolean;
      reason?: string;
    }> = [];

    for (const lead of candidates) {
      let phoneFound: string | null = null;
      try {
        const contacts = await extractContactsFromWebsite(lead.website_url!, {
          maxPages: 6,
          timeoutMs: 10_000,
        });
        for (const p of contacts?.phones ?? []) {
          const v1 = validateFrenchPhone(p.normalized ?? "");
          const v2 = validateFrenchPhone(p.raw);
          if (v1.valid && v1.cleaned) {
            phoneFound = v1.cleaned;
            break;
          }
          if (v2.valid && v2.cleaned) {
            phoneFound = v2.cleaned;
            break;
          }
        }
      } catch {
        // non-fatal — leave this lead untouched
      }

      let updated = false;
      if (phoneFound && !dryRun) {
        const { error: updErr } = await service
          .from("leads")
          .update({ phone: phoneFound, updated_at: new Date().toISOString() })
          .eq("id", lead.id)
          .eq("user_id", user.id);
        if (!updErr) {
          updated = true;
          await service
            .from("lead_enrichment_events")
            .insert({
              lead_id: lead.id,
              provider: "phone_backfill",
              status: "success",
              error_message: `Backfilled phone from ${lead.website_url}: ${phoneFound}`,
            })
            .then(() => undefined)
            .then(undefined, () => undefined);
        }
      }

      details.push({
        lead_id: lead.id,
        name: lead.primary_name,
        website: lead.website_url!,
        phone_found: phoneFound,
        updated,
      });

      await sleep(150); // polite rate-limit between target hosts
    }

    return NextResponse.json({
      scanned: candidates.length,
      phones_found: details.filter((d) => d.phone_found).length,
      leads_updated: details.filter((d) => d.updated).length,
      dry_run: dryRun,
      details,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/leads/backfill-phones]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

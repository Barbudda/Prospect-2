// Re-validates every lead's email and phone using the strict validators.
// Nulls out invalid contacts in the DB. Run once after deploying the validator fix.
//
// POST /api/admin/clean-contacts        — actually clean
// POST /api/admin/clean-contacts  { dry_run: true }  — preview, no writes

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { validateEmail, validateFrenchPhone } from "@/lib/utils/contact-validator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface LeadRow {
  id: string;
  primary_name: string;
  email: string | null;
  phone: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
    const dryRun = body.dry_run === true;

    const service = createServiceClient();
    const { data: leads, error } = await service
      .from("leads")
      .select("id, primary_name, email, phone")
      .eq("user_id", user.id)
      .or("email.not.is.null,phone.not.is.null");

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (leads ?? []) as LeadRow[];

    let invalidEmails = 0;
    let invalidPhones = 0;
    let cleanedEmails = 0;
    let cleanedPhones = 0;
    const emailSamples: Array<{ name: string; bad: string; reason: string }> = [];
    const phoneSamples: Array<{ name: string; bad: string; reason: string }> = [];

    for (const lead of rows) {
      const updates: { email?: string | null; phone?: string | null } = {};

      if (lead.email) {
        const r = validateEmail(lead.email);
        if (!r.valid) {
          invalidEmails++;
          if (emailSamples.length < 20)
            emailSamples.push({ name: lead.primary_name, bad: lead.email, reason: r.reason ?? "" });
          updates.email = null;
        } else if (r.cleaned && r.cleaned !== lead.email) {
          cleanedEmails++;
          updates.email = r.cleaned;
        }
      }

      if (lead.phone) {
        const r = validateFrenchPhone(lead.phone);
        if (!r.valid) {
          invalidPhones++;
          if (phoneSamples.length < 20)
            phoneSamples.push({ name: lead.primary_name, bad: lead.phone, reason: r.reason ?? "" });
          updates.phone = null;
        } else if (r.cleaned && r.cleaned !== lead.phone) {
          cleanedPhones++;
          updates.phone = r.cleaned;
        }
      }

      if (!dryRun && Object.keys(updates).length > 0) {
        await service.from("leads").update(updates).eq("id", lead.id);
      }
    }

    return NextResponse.json({
      dry_run: dryRun,
      scanned: rows.length,
      invalid_emails_nulled: invalidEmails,
      invalid_phones_nulled: invalidPhones,
      reformatted_emails: cleanedEmails,
      reformatted_phones: cleanedPhones,
      email_samples: emailSamples,
      phone_samples: phoneSamples,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[POST /api/admin/clean-contacts]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

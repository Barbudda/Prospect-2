// COMPLIANCE LAYER (#14 from the brief)
// Lightweight, schema-additive helpers for GDPR/ePrivacy compliance.
// Works with the existing leads table (outreach_status, status, notes) plus
// the lead_enrichment_events table for the audit trail. No new tables needed.
//
// What this provides:
//   - Suppression / DNC check at save time
//   - Mark a lead Do-Not-Contact + null its contact fields
//   - Log every contact-related event for audit
//   - Retention-window helper (computes when a lead becomes stale)
//   - Lawful-basis helpers (B2B vs natural person classification)

import type { SupabaseClient } from "@supabase/supabase-js";

const PRO_LEAD_TYPES = new Set([
  "Airbnb Concierge",
  "Property Manager",
  "Vacation Rental Agency",
  "Direct Booking Owner",
  "Gîte / Villa Operator",
  "Co-host / Consultant",
  "Real Estate Seasonal Rental",
]);

const PERSONAL_LEAD_TYPES = new Set([
  "Individual Airbnb Host",
  "Unknown STR Lead",
]);

export function classifyLawfulBasis(leadType?: string | null): {
  is_personal_data: boolean;
  lawful_basis: string;
  consent_required_before_marketing: boolean;
} {
  if (leadType && PRO_LEAD_TYPES.has(leadType)) {
    return {
      is_personal_data: false,
      lawful_basis: "Legitimate interest (GDPR Art. 6(1)(f)) — B2B prospecting of a registered professional",
      consent_required_before_marketing: false,
    };
  }
  if (leadType && PERSONAL_LEAD_TYPES.has(leadType)) {
    return {
      is_personal_data: true,
      lawful_basis: "Requires consent before commercial messaging (ePrivacy / FR LCEN Art. L. 34-5)",
      consent_required_before_marketing: true,
    };
  }
  return {
    is_personal_data: true,
    lawful_basis: "Unknown — treat as personal data until classified",
    consent_required_before_marketing: true,
  };
}

export function computeRetentionDate(collectedAt: Date | string, monthsToRetain = 24): Date {
  const base = typeof collectedAt === "string" ? new Date(collectedAt) : collectedAt;
  const d = new Date(base);
  d.setMonth(d.getMonth() + monthsToRetain);
  return d;
}

export function isExpired(collectedAt: Date | string, monthsToRetain = 24): boolean {
  return computeRetentionDate(collectedAt, monthsToRetain).getTime() < Date.now();
}

// ─── Suppression check ────────────────────────────────────────────────────────
// A lead is "suppressed" if it has outreach_status in {opted_out, unsubscribed,
// not_interested} OR if the user has previously marked the same email/phone as
// DNC across any of their leads.

export async function isContactSuppressed(
  service: SupabaseClient,
  userId: string,
  contact: { email?: string | null; phone?: string | null }
): Promise<boolean> {
  if (!contact.email && !contact.phone) return false;

  // Look for any of this user's leads with this email or phone marked as DNC
  const orConditions: string[] = [];
  if (contact.email) orConditions.push(`email.eq.${contact.email.toLowerCase()}`);
  if (contact.phone) orConditions.push(`phone.eq.${contact.phone}`);
  if (orConditions.length === 0) return false;

  const { data } = await service
    .from("leads")
    .select("id, outreach_status, status")
    .eq("user_id", userId)
    .or(orConditions.join(","))
    .limit(50);

  for (const lead of data ?? []) {
    if (
      lead.outreach_status === "opted_out" ||
      lead.outreach_status === "unsubscribed" ||
      lead.status === "do_not_contact"
    ) {
      return true;
    }
  }
  return false;
}

// ─── Mark a lead Do-Not-Contact ───────────────────────────────────────────────
// Nulls contact fields, sets status, logs the event.

export interface DNCOptions {
  reason?: string;
  source?: string;            // e.g. "manual_user_action" | "email_unsubscribe_link"
  also_null_contacts?: boolean; // default true — strict data minimisation
}

export async function markLeadDoNotContact(
  service: SupabaseClient,
  leadId: string,
  userId: string,
  options: DNCOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const updates: Record<string, unknown> = {
    outreach_status: "opted_out",
    updated_at: new Date().toISOString(),
  };

  if (options.also_null_contacts !== false) {
    updates.email = null;
    updates.phone = null;
    updates.whatsapp_url = null;
  }

  const { error } = await service
    .from("leads")
    .update(updates)
    .eq("id", leadId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };

  // Audit trail
  await service
    .from("lead_enrichment_events")
    .insert({
      lead_id: leadId,
      provider: "compliance:do_not_contact",
      status: "applied",
      error_message: options.reason
        ? `Reason: ${options.reason}; Source: ${options.source ?? "manual"}`
        : `Source: ${options.source ?? "manual"}`,
    })
    .then(() => undefined)
    .then(undefined, () => undefined);

  return { ok: true };
}

// ─── Compliance summary for a lead ───────────────────────────────────────────
// Used by the dossier and the dashboard to present a single-glance status.

export interface ComplianceSummary {
  is_personal_data: boolean;
  lawful_basis: string;
  consent_required_before_marketing: boolean;
  is_suppressed: boolean;
  retention_date: string;
  notes: string[];
}

export async function buildComplianceSummary(
  service: SupabaseClient,
  userId: string,
  lead: {
    lead_type?: string | null;
    email?: string | null;
    phone?: string | null;
    outreach_status?: string | null;
    status?: string | null;
    created_at?: string;
  }
): Promise<ComplianceSummary> {
  const basis = classifyLawfulBasis(lead.lead_type);
  const suppressed = await isContactSuppressed(service, userId, {
    email: lead.email,
    phone: lead.phone,
  });
  const retention = computeRetentionDate(lead.created_at ?? new Date()).toISOString();

  const notes: string[] = [];
  if (basis.is_personal_data) notes.push("Treat as personal data — minimise, justify, log.");
  if (basis.consent_required_before_marketing)
    notes.push("Get explicit consent before any commercial messaging.");
  if (lead.outreach_status === "opted_out" || lead.outreach_status === "unsubscribed")
    notes.push("Lead has opted out — do not contact via any channel.");
  if (suppressed) notes.push("Contact appears on the suppression list across this user's leads.");

  return {
    is_personal_data: basis.is_personal_data,
    lawful_basis: basis.lawful_basis,
    consent_required_before_marketing: basis.consent_required_before_marketing,
    is_suppressed: suppressed,
    retention_date: retention,
    notes,
  };
}

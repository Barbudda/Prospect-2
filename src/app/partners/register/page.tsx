"use client";

import { useState } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const KINDS: Array<{ value: string; label: string; tagline: string }> = [
  { value: "cleaning", label: "Cleaning company", tagline: "Turnovers, linens, deep cleans" },
  { value: "photography", label: "Photographer", tagline: "Interior + drone shoots for STR listings" },
  { value: "interior_design", label: "Interior designer / stager", tagline: "Renovations, staging, ROI-led refresh" },
  { value: "smart_lock", label: "Smart-lock installer", tagline: "Self-check-in hardware + on-call support" },
  { value: "linen", label: "Linen / laundry", tagline: "Turnaround linen swaps + rental" },
  { value: "maintenance", label: "Maintenance / handyman", tagline: "On-call repairs, gardening, pool" },
  { value: "accounting", label: "Accounting / tax", tagline: "Meublé de tourisme regime, BIC, etc." },
  { value: "concierge_outsource", label: "Concierge subcontractor", tagline: "You can be the operations layer for someone else" },
  { value: "other", label: "Other / not listed", tagline: "We'll route you appropriately" },
];

export default function PartnersRegisterPage() {
  const [form, setForm] = useState({
    kind: "cleaning",
    name: "",
    city: "",
    country: "France",
    website: "",
    email: "",
    phone: "",
    service_area_km: "30",
    notes: "",
    consent: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/partners/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          service_area_km: Number(form.service_area_km),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (ok) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border/60 bg-background/80 backdrop-blur-md">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center">
            <Link href="/tools" className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                <span className="text-primary-foreground text-xs font-bold tracking-tight">P</span>
              </div>
              <span className="font-semibold text-sm tracking-tight">Prospect — Partner network</span>
            </Link>
          </div>
        </header>
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-16 text-center space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight">You&apos;re in.</h1>
          <p className="text-muted-foreground">
            Thanks for joining the partner network. We&apos;ll match you with STR
            operators in your service area as we onboard them.
          </p>
          <p className="text-xs text-muted-foreground">
            You can request removal at any time by replying to any email we
            send you, or by writing to dpo@prospect-2.app.
          </p>
          <Link href="/tools" className="inline-block text-sm text-primary hover:underline">
            ← Back to tools
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/tools" className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <span className="text-primary-foreground text-xs font-bold tracking-tight">P</span>
            </div>
            <span className="font-semibold text-sm tracking-tight">Prospect — Partner network</span>
          </Link>
          <Link href="/tools" className="text-xs text-muted-foreground hover:text-foreground">
            Free tools
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Join the partner network</h1>
          <p className="text-muted-foreground text-sm">
            We help STR owners build direct-booking channels. When we onboard
            an owner in your service area, we refer the operational work to a
            single trusted local partner. Tell us what you do — we&apos;ll keep
            you in mind.
          </p>
        </header>

        <form onSubmit={submit} className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
          <Field label="What do you do?">
            <select
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
              className="input"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label} — {k.tagline}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Business name" required>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Acme Cleaning SAS"
                className="input"
                required
              />
            </Field>
            <Field label="Primary city">
              <input
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="Biarritz"
                className="input"
              />
            </Field>
            <Field label="Service radius (km)">
              <input
                type="number"
                min={1}
                max={500}
                value={form.service_area_km}
                onChange={(e) => setForm((f) => ({ ...f, service_area_km: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="Country">
              <input
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                className="input"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="contact@acme.fr"
                className="input"
              />
            </Field>
            <Field label="Phone">
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+33 6 12 34 56 78"
                className="input"
              />
            </Field>
            <Field label="Website (optional)" full>
              <input
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                placeholder="https://acme.fr"
                className="input"
              />
            </Field>
            <Field label="Anything else we should know? (optional)" full>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                className="input"
                maxLength={1000}
                placeholder="Languages spoken, certifications, current capacity…"
              />
            </Field>
          </div>

          <label className="flex items-start gap-2 text-xs text-muted-foreground border-t border-border/40 pt-4">
            <input
              type="checkbox"
              checked={form.consent}
              onChange={(e) => setForm((f) => ({ ...f, consent: e.target.checked }))}
              className="mt-0.5"
              required
            />
            <span>
              I&apos;m authorised to register this business and consent to being
              contacted by Prospect or matched STR operators about partnership
              opportunities. (GDPR Art 6(1)(a) consent, 24-month retention,
              opt-out at any time.)
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting || !form.consent || !form.name.trim()}
            className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? "Submitting…" : "Join the partner network"}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </main>
    </div>
  );
}

function Field({
  label,
  children,
  full,
  required,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  required?: boolean;
}) {
  return (
    <label className={`space-y-1 block ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

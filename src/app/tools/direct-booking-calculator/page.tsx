"use client";

import { useState } from "react";

export const dynamic = "force-dynamic";

interface CalcResult {
  inputs: { nightlyRate: number; nightsPerYear: number; commissionPct: number };
  gross_annual_revenue: number;
  ota_fees_per_year: number;
  direct_booking_target_per_year: number;
  potential_annual_savings: number;
  disclaimer: string;
  lead_id?: string | null;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export default function LeakCalculatorPage() {
  const [nightlyRate, setNightlyRate] = useState("");
  const [nightsPerYear, setNightsPerYear] = useState("");
  const [commissionPct, setCommissionPct] = useState("15");
  const [city, setCity] = useState("");
  const [listingUrl, setListingUrl] = useState("");
  const [email, setEmail] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function calculate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/tools/calculate-leak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nightly_rate: Number(nightlyRate),
          nights_booked_per_year: Number(nightsPerYear),
          ota_commission_pct: Number(commissionPct),
          listing_url: listingUrl || undefined,
          city: city || undefined,
          email: email || undefined,
          email_consent: emailConsent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">OTA fee leak calculator</h1>
        <p className="text-muted-foreground text-sm">
          A 5-second estimate of how much Airbnb takes from your annual revenue,
          and how much you could keep by building a direct-booking channel.
        </p>
      </header>

      <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nightly rate (€)">
            <input
              type="number"
              min={10}
              max={5000}
              value={nightlyRate}
              onChange={(e) => setNightlyRate(e.target.value)}
              placeholder="180"
              className="input"
            />
          </Field>
          <Field label="Nights booked per year">
            <input
              type="number"
              min={1}
              max={365}
              value={nightsPerYear}
              onChange={(e) => setNightsPerYear(e.target.value)}
              placeholder="180"
              className="input"
            />
          </Field>
          <Field label="OTA commission % (default 15)">
            <input
              type="number"
              min={3}
              max={25}
              value={commissionPct}
              onChange={(e) => setCommissionPct(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="City (optional)">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Paris"
              className="input"
            />
          </Field>
          <Field label="Listing URL (optional)" full>
            <input
              value={listingUrl}
              onChange={(e) => setListingUrl(e.target.value)}
              placeholder="https://www.airbnb.com/rooms/…"
              className="input"
            />
          </Field>
        </div>

        <details className="rounded-lg border border-border/40 bg-muted/30 p-3">
          <summary className="text-xs font-medium cursor-pointer">Email the full report (optional)</summary>
          <div className="mt-3 space-y-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input"
            />
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={emailConsent}
                onChange={(e) => setEmailConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I agree to receive the full report and one follow-up message
                with related insights. I can unsubscribe at any time. (GDPR
                consent, 12-month retention.)
              </span>
            </label>
          </div>
        </details>

        <button
          onClick={calculate}
          disabled={loading || !nightlyRate || !nightsPerYear}
          className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Calculating…" : "Calculate my leak"}
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {result && (
        <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Stat
              label="Annual gross revenue"
              value={fmt(result.gross_annual_revenue)}
              hint="Nightly × nights"
            />
            <Stat
              label="OTA fees you pay per year"
              value={fmt(result.ota_fees_per_year)}
              hint={`${result.inputs.commissionPct}% of gross`}
              danger
            />
            <Stat
              label="Direct-booking target (12 months)"
              value={fmt(result.direct_booking_target_per_year)}
              hint="30% of gross — achievable with structured effort"
            />
            <Stat
              label="Potential savings per year"
              value={fmt(result.potential_annual_savings)}
              hint="Direct-booking target × OTA commission rate"
              success
            />
          </div>
          <p className="text-xs text-muted-foreground italic">{result.disclaimer}</p>
          {result.lead_id && (
            <p className="text-xs text-emerald-600">
              ✓ Report saved. We&apos;ll email you with detailed remediation steps.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`space-y-1 ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  hint,
  success,
  danger,
}: {
  label: string;
  value: string;
  hint?: string;
  success?: boolean;
  danger?: boolean;
}) {
  const tone = success
    ? "text-emerald-600"
    : danger
    ? "text-red-600"
    : "text-foreground";
  return (
    <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

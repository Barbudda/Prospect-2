"use client";

import { useState } from "react";

export const dynamic = "force-dynamic";

interface AuditResponse {
  url: string;
  fetched: boolean;
  audit_score: number;
  findings: Array<{ code: string; severity: "high" | "medium" | "low"; description: string; remediation?: string }>;
  signals: Record<string, unknown>;
  lead_id?: string | null;
  error?: string;
}

const SEVERITY_BADGE: Record<string, string> = {
  high: "bg-red-500/10 text-red-600",
  medium: "bg-amber-500/10 text-amber-600",
  low: "bg-blue-500/10 text-blue-600",
};

export default function ListingAuditPage() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [city, setCity] = useState("");
  const [result, setResult] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function audit() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/tools/listing-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          email: email || undefined,
          email_consent: emailConsent,
          city: city || undefined,
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
        <h1 className="text-2xl font-semibold tracking-tight">Direct-booking site audit</h1>
        <p className="text-muted-foreground text-sm">
          Paste your direct-booking website URL. We&apos;ll grade it against the
          eight conversion-critical signals top STR operators get right.
        </p>
      </header>

      <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
        <label className="space-y-1 block">
          <span className="text-xs font-medium text-muted-foreground">Public website URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://my-villa.fr"
            className="input"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-xs font-medium text-muted-foreground">Primary city (optional)</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Biarritz" className="input" />
        </label>

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
                Email me the full report and one follow-up message with
                related insights. I can unsubscribe at any time.
              </span>
            </label>
          </div>
        </details>

        <button
          onClick={audit}
          disabled={loading || !url.trim()}
          className="w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Auditing your site…" : "Audit my site"}
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Overall score</p>
                <p className="text-4xl font-bold tabular-nums">
                  {result.audit_score}
                  <span className="text-base text-muted-foreground">/100</span>
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                {result.fetched ? `Audited ${result.url}` : `Could not reach ${result.url} — see findings`}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-3">
            <p className="text-sm font-semibold">Findings ({result.findings.length})</p>
            {result.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to flag — solid baseline.</p>
            ) : (
              result.findings.map((f, i) => (
                <div key={`${f.code}-${i}`} className="rounded-lg border border-border/40 p-3">
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${SEVERITY_BADGE[f.severity]}`}>
                      {f.severity}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{f.code}</span>
                  </div>
                  <p className="text-sm">{f.description}</p>
                  {f.remediation && (
                    <p className="text-xs text-muted-foreground mt-1.5">→ {f.remediation}</p>
                  )}
                </div>
              ))
            )}
          </div>

          {result.lead_id && (
            <p className="text-xs text-emerald-600">
              ✓ Report saved. We&apos;ll email you the full remediation playbook.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

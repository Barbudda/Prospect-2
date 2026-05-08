"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

interface ProviderStatus {
  name: string;
  type: string;
  status: "configured" | "missing_key" | "failing" | "disabled";
}

export default function DashboardPage() {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("France");
  const [targetType, setTargetType] = useState("all");
  const [requestedLeads, setRequestedLeads] = useState("50");
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [enableLocalBusiness, setEnableLocalBusiness] = useState(true);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [enableExtraction, setEnableExtraction] = useState(true);
  const [enableEnrichment, setEnableEnrichment] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    fetch("/api/providers/status")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => {});
  }, []);

  const hasSearchProvider = providers.some(
    (p) =>
      (p.type === "search" || p.type === "local_business") &&
      p.status === "configured"
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim()) {
      toast.error("Please enter a city");
      return;
    }

    setLoading(true);
    try {
      const createRes = await fetch("/api/runs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: city.trim(),
          country: country.trim(),
          targetType,
          requestedLeads: parseInt(requestedLeads, 10),
          config: {
            enableLocalBusiness,
            enableWebSearch,
            enableContactExtraction: enableExtraction,
            enableEnrichment,
          },
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error ?? "Failed to create run");
      }

      const { run_id } = await createRes.json();

      // Start the run
      fetch(`/api/runs/${run_id}/start`, { method: "POST" }).catch(() => {});

      router.push(`/runs/${run_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start search");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Find Airbnb Leads</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Enter a city to automatically discover contactable Airbnb-related B2B prospects.
        </p>
      </div>

      {/* Compliance notice */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        <strong>Compliance Notice:</strong> This tool collects only publicly available business
        information for professional B2B outreach purposes. All leads are sourced from public web
        pages, business directories, and official APIs. Use responsibly and in accordance with
        applicable data protection regulations (GDPR, CCPA, etc.).
      </div>

      {/* No provider warning */}
      {!hasSearchProvider && providers.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            No search provider configured. Add at least one provider in{" "}
            <a href="/settings" className="underline font-medium">
              Settings
            </a>{" "}
            to run automated lead discovery.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Search Parameters</CardTitle>
          <CardDescription>Define your target market and lead count</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City / Area *</Label>
                <Input
                  id="city"
                  placeholder="e.g. Biarritz"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country *</Label>
                <Input
                  id="country"
                  placeholder="e.g. France"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="targetType">Target Type</Label>
                <Select value={targetType} onValueChange={(v: string | null) => { if (v) setTargetType(v); }}>
                  <SelectTrigger id="targetType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Airbnb-related</SelectItem>
                    <SelectItem value="concierges">Concierge Services</SelectItem>
                    <SelectItem value="property_managers">Property Managers</SelectItem>
                    <SelectItem value="direct_owners">Direct Booking Owners</SelectItem>
                    <SelectItem value="agencies">Vacation Rental Agencies</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="requestedLeads">Number of Leads</Label>
                <Select value={requestedLeads} onValueChange={(v: string | null) => { if (v) setRequestedLeads(v); }}>
                  <SelectTrigger id="requestedLeads">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25 leads</SelectItem>
                    <SelectItem value="50">50 leads</SelectItem>
                    <SelectItem value="100">100 leads</SelectItem>
                    <SelectItem value="250">250 leads</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Advanced sources */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <span>{showAdvanced ? "▾" : "▸"}</span> Advanced Sources
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-2 pl-4 border-l">
                  {[
                    { id: "local", label: "Local Business Search", value: enableLocalBusiness, set: setEnableLocalBusiness },
                    { id: "web", label: "Web Search Discovery", value: enableWebSearch, set: setEnableWebSearch },
                    { id: "extraction", label: "Website Contact Extraction", value: enableExtraction, set: setEnableExtraction },
                    { id: "enrichment", label: "Enrichment APIs (if configured)", value: enableEnrichment, set: setEnableEnrichment },
                  ].map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <Checkbox
                        id={item.id}
                        checked={item.value}
                        onCheckedChange={(v) => item.set(Boolean(v))}
                      />
                      <label htmlFor={item.id} className="text-sm cursor-pointer">
                        {item.label}
                      </label>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2">
                    External STR Provider: Not configured. Add credentials in Settings.
                  </p>
                </div>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Starting search..." : "Find Leads"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Provider status summary */}
      {providers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Active Providers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {providers
                .filter((p) => p.status === "configured")
                .map((p) => (
                  <Badge key={p.name} variant="secondary" className="text-xs">
                    {p.name}
                  </Badge>
                ))}
              {!hasSearchProvider && (
                <span className="text-xs text-muted-foreground">
                  No providers active.{" "}
                  <a href="/settings" className="underline">
                    Configure one →
                  </a>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

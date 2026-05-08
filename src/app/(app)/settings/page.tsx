"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { ProviderStatusInfo } from "@/lib/types";

interface ProviderWithKey extends ProviderStatusInfo {
  showKey?: boolean;
  testResult?: "ok" | "fail" | null;
  testing?: boolean;
}

const ENV_HINTS: Record<string, string> = {
  "Claude (Anthropic)": "ANTHROPIC_API_KEY",
  SerpAPI: "SERPAPI_API_KEY",
  "Brave Search": "BRAVE_SEARCH_API_KEY",
  "Google Programmable Search": "GOOGLE_PROGRAMMABLE_SEARCH_API_KEY",
  "Bing Web Search": "BING_WEB_SEARCH_API_KEY",
  Tavily: "TAVILY_API_KEY",
  Exa: "EXA_API_KEY",
  "Google Places": "GOOGLE_PLACES_API_KEY",
  Outscraper: "OUTSCRAPER_API_KEY",
  Apify: "APIFY_API_KEY",
  "Hunter.io": "HUNTER_API_KEY",
  Dropcontact: "DROPCONTACT_API_KEY",
  "Apollo.io": "APOLLO_API_KEY",
  Prospeo: "PROSPEO_API_KEY",
  FullEnrich: "FULLENRICH_API_KEY",
  "People Data Labs": "PEOPLE_DATA_LABS_API_KEY",
  "Snov.io": "SNOV_API_KEY",
  Kaspr: "KASPR_API_KEY",
};

function StatusBadge({ status }: { status: ProviderStatusInfo["status"] }) {
  const map = {
    configured: { label: "Configured", variant: "default" },
    missing_key: { label: "Missing Key", variant: "secondary" },
    failing: { label: "Failing", variant: "destructive" },
    disabled: { label: "Disabled", variant: "outline" },
  } as const;
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function ProviderCard({
  provider,
  onTest,
}: {
  provider: ProviderWithKey;
  onTest: (name: string) => void;
}) {
  const isTestable = ["SerpAPI", "Brave Search", "Tavily", "Google Places", "Hunter.io", "Claude (Anthropic)"].includes(provider.name);
  const envKey = ENV_HINTS[provider.name];
  const isStrData = provider.type === "str_data";

  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 mb-1">
          <span className="font-medium text-sm">{provider.name}</span>
          <StatusBadge status={isStrData ? "disabled" : provider.status} />
          {provider.testResult === "ok" && (
            <span className="text-xs text-green-600 font-medium">✓ Connected</span>
          )}
          {provider.testResult === "fail" && (
            <span className="text-xs text-red-600 font-medium">✗ Failed</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{provider.description}</p>
        {envKey && !isStrData && (
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            env: {envKey}
          </p>
        )}
        {isStrData && (
          <p className="text-xs text-muted-foreground mt-1 italic">
            Interface ready — awaiting official API credentials
          </p>
        )}
      </div>
      {isTestable && !isStrData && (
        <Button
          variant="outline"
          size="sm"
          disabled={provider.status !== "configured" || provider.testing}
          onClick={() => onTest(provider.name)}
          className="shrink-0"
        >
          {provider.testing ? "Testing..." : "Test Connection"}
        </Button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderWithKey[]>([]);

  useEffect(() => {
    fetch("/api/providers/status")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => {});
  }, []);

  async function testProvider(name: string) {
    setProviders((prev) =>
      prev.map((p) => (p.name === name ? { ...p, testing: true, testResult: null } : p))
    );

    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: name }),
      });
      const data = await res.json();

      if (data.ok) {
        toast.success(`${name}: Connected successfully`);
        setProviders((prev) =>
          prev.map((p) => (p.name === name ? { ...p, testing: false, testResult: "ok" } : p))
        );
      } else {
        toast.error(data.error ?? `${name}: Test failed`);
        setProviders((prev) =>
          prev.map((p) => (p.name === name ? { ...p, testing: false, testResult: "fail" } : p))
        );
      }
    } catch {
      toast.error(`${name}: Connection test failed`);
      setProviders((prev) =>
        prev.map((p) => (p.name === name ? { ...p, testing: false, testResult: "fail" } : p))
      );
    }
  }

  const search = providers.filter((p) => p.type === "search");
  const local = providers.filter((p) => p.type === "local_business");
  const enrichment = providers.filter((p) => p.type === "enrichment");
  const str = providers.filter((p) => p.type === "str_data");
  const ai = providers.filter((p) => p.type === "ai");

  const hasAnyConfigured = providers.some((p) => p.status === "configured");

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure API providers for automated lead discovery.
        </p>
      </div>

      {!hasAnyConfigured && providers.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-200">
          No providers configured. Add at least one search or local business API key using the instructions below.
        </div>
      )}

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed space-y-1">
        <p>
          <strong>Local:</strong> Set keys in <code className="font-mono">.env.local</code> and restart the dev server.
        </p>
        <p>
          <strong>Vercel:</strong> Add keys via <code className="font-mono">vercel env add KEY production</code> or in your Vercel project settings under Environment Variables, then redeploy.
        </p>
        <p>Keys are never stored in the database or exposed to the browser.</p>
      </div>

      <Tabs defaultValue="search">
        <TabsList>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="local">Local Business</TabsTrigger>
          <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="str">STR Data</TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Web Search Providers</CardTitle>
              <CardDescription>
                Used to discover Airbnb-related businesses via web search queries.
                Add at least one for Engine 2 to run.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {search.map((p) => (
                <ProviderCard key={p.name} provider={p} onTest={testProvider} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="local" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Local Business Providers</CardTitle>
              <CardDescription>
                Used to find businesses on Google Maps and similar directories (Engine 1).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {local.map((p) => (
                <ProviderCard key={p.name} provider={p} onTest={testProvider} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="enrichment" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Enrichment Providers</CardTitle>
              <CardDescription>
                Used to find verified email addresses for leads that lack contact info (Engine 4).
                Optional but significantly improves lead quality.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {enrichment.map((p) => (
                <ProviderCard key={p.name} provider={p} onTest={testProvider} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Providers</CardTitle>
              <CardDescription>
                Used to generate personalized outreach emails for individual leads.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ai.map((p) => (
                <ProviderCard key={p.name} provider={p} onTest={testProvider} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="str" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>STR Data Providers</CardTitle>
              <CardDescription>
                Short-term rental data platforms. Integration interfaces are ready for V2.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {str.map((p) => (
                <ProviderCard key={p.name} provider={p} onTest={testProvider} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import type { EnrichmentProvider, EnrichmentResult } from "@/lib/types";

export class HunterProvider implements EnrichmentProvider {
  readonly name = "Hunter.io";

  isConfigured(): boolean {
    return Boolean(process.env.HUNTER_API_KEY);
  }

  async enrichCompany(domain: string, companyName: string, country: string): Promise<EnrichmentResult> {
    if (!this.isConfigured()) {
      return { provider: this.name, status: "skipped" };
    }

    try {
      const params = new URLSearchParams({
        domain,
        api_key: process.env.HUNTER_API_KEY!,
      });
      const res = await fetch(
        `https://api.hunter.io/v2/domain-search?${params.toString()}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        return { provider: this.name, status: "failed", error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const emails = (data.data?.emails ?? [])
        .filter((e: Record<string, unknown>) => e.type === "generic" || (e.confidence as number) >= 70)
        .map((e: Record<string, unknown>) => ({
          value: e.value as string,
          confidence: (e.confidence as number) >= 90 ? "high" as const : "medium" as const,
          verified: (e.verification as Record<string, unknown>)?.status === "valid",
        }))
        .slice(0, 3);

      return {
        provider: this.name,
        status: emails.length > 0 ? "success" : "partial",
        emails,
        raw: data.data,
      };
    } catch (err) {
      return {
        provider: this.name,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async enrichPerson(
    name: string,
    companyName: string,
    domain: string,
    country: string
  ): Promise<EnrichmentResult> {
    if (!this.isConfigured()) {
      return { provider: this.name, status: "skipped" };
    }

    try {
      const nameParts = name.trim().split(" ");
      const first = nameParts[0] ?? "";
      const last = nameParts.slice(1).join(" ") ?? "";

      const params = new URLSearchParams({
        first_name: first,
        last_name: last,
        domain,
        api_key: process.env.HUNTER_API_KEY!,
      });

      const res = await fetch(
        `https://api.hunter.io/v2/email-finder?${params.toString()}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!res.ok) {
        return { provider: this.name, status: "failed", error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const email = data.data?.email;

      if (!email) return { provider: this.name, status: "partial" };

      return {
        provider: this.name,
        status: "success",
        emails: [
          {
            value: email,
            confidence: data.data?.confidence >= 90 ? "high" : "medium",
            verified: data.data?.verification?.status === "valid",
          },
        ],
        raw: data.data,
      };
    } catch (err) {
      return {
        provider: this.name,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }
}

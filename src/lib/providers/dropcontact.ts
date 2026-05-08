import type { EnrichmentProvider, EnrichmentResult } from "@/lib/types";

export class DropcontactProvider implements EnrichmentProvider {
  readonly name = "Dropcontact";

  isConfigured(): boolean {
    return Boolean(process.env.DROPCONTACT_API_KEY);
  }

  async enrichCompany(domain: string, companyName: string, country: string): Promise<EnrichmentResult> {
    if (!this.isConfigured()) return { provider: this.name, status: "skipped" };

    try {
      const res = await fetch("https://api.dropcontact.com/b2b-api/v2/enrich/single", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Access-Token": process.env.DROPCONTACT_API_KEY!,
        },
        body: JSON.stringify({
          website: domain,
          company: companyName,
          country,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        return { provider: this.name, status: "failed", error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const email = data.email?.[0]?.email;
      if (!email) return { provider: this.name, status: "partial" };

      return {
        provider: this.name,
        status: "success",
        emails: [
          {
            value: email,
            confidence: "medium",
            verified: data.email?.[0]?.qualification === "valid",
          },
        ],
        raw: data,
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
    if (!this.isConfigured()) return { provider: this.name, status: "skipped" };

    const nameParts = name.trim().split(" ");
    const first = nameParts[0] ?? "";
    const last = nameParts.slice(1).join(" ") ?? "";

    try {
      const res = await fetch("https://api.dropcontact.com/b2b-api/v2/enrich/single", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Access-Token": process.env.DROPCONTACT_API_KEY!,
        },
        body: JSON.stringify({
          first_name: first,
          last_name: last,
          website: domain,
          company: companyName,
          country,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        return { provider: this.name, status: "failed", error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const email = data.email?.[0]?.email;
      if (!email) return { provider: this.name, status: "partial" };

      return {
        provider: this.name,
        status: "success",
        emails: [
          {
            value: email,
            confidence: "medium",
            verified: data.email?.[0]?.qualification === "valid",
          },
        ],
        raw: data,
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

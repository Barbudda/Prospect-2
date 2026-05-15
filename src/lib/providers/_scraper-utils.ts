// Shared scraping utilities — UA rotation, fetch with backoff, rate limiting.
//
// Per-host concurrency is enforced via p-queue; backoff handles 429/503.
// No proxies in v1; an IP block surfaces as a logged failure.

import PQueue from "p-queue";
import { validatePublicUrl } from "@/lib/utils/ssrf";
import { logRobotsCheck } from "./_robots";

const REAL_BROWSER_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0",
];

function pickUA(): string {
  return REAL_BROWSER_UAS[Math.floor(Math.random() * REAL_BROWSER_UAS.length)];
}

const queues = new Map<string, PQueue>();

function queueForHost(host: string): PQueue {
  let q = queues.get(host);
  if (!q) {
    q = new PQueue({ concurrency: 2, intervalCap: 2, interval: 1500 });
    queues.set(host, q);
  }
  return q;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ScrapeFetchOpts {
  acceptLanguage?: string;
  referer?: string;
  timeoutMs?: number;
  maxRetries?: number;
  parseJson?: boolean;
}

export interface ScrapeFetchResult {
  status: number;
  ok: boolean;
  body: string;
  durationMs: number;
  attempts: number;
  url: string;
  hostBlocked: boolean;
}

export async function scrapeFetch(
  url: string,
  opts: ScrapeFetchOpts = {}
): Promise<ScrapeFetchResult> {
  const validation = validatePublicUrl(url);
  if (!validation.ok) {
    return {
      status: 0,
      ok: false,
      body: "",
      durationMs: 0,
      attempts: 0,
      url,
      hostBlocked: true,
    };
  }

  const host = hostFromUrl(url);
  const queue = queueForHost(host);

  // Best-effort robots.txt log (fire-and-forget — never delays the fetch)
  void logRobotsCheck(url);

  return queue.add(async () => {
    const maxRetries = opts.maxRetries ?? 3;
    const timeout = opts.timeoutMs ?? 15_000;

    let attempt = 0;
    const start = Date.now();
    let lastStatus = 0;
    let lastBody = "";

    while (attempt < maxRetries) {
      attempt++;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": pickUA(),
            Accept:
              opts.parseJson
                ? "application/json,text/plain,*/*"
                : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": opts.acceptLanguage ?? "fr-FR,fr;q=0.9,en;q=0.6",
            ...(opts.referer ? { Referer: opts.referer } : {}),
          },
          redirect: "follow",
          signal: AbortSignal.timeout(timeout),
        });

        lastStatus = res.status;
        if (res.status === 429 || res.status === 503) {
          // Exponential backoff
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        lastBody = await res.text().catch(() => "");
        return {
          status: res.status,
          ok: res.ok,
          body: lastBody,
          durationMs: Date.now() - start,
          attempts: attempt,
          url,
          hostBlocked: false,
        };
      } catch {
        if (attempt >= maxRetries) break;
        await sleep(500 * 2 ** (attempt - 1));
      }
    }

    return {
      status: lastStatus,
      ok: false,
      body: lastBody,
      durationMs: Date.now() - start,
      attempts: attempt,
      url,
      hostBlocked: lastStatus === 0,
    };
  }) as Promise<ScrapeFetchResult>;
}

// Observability: every scrape attempt logs this shape (matches existing logger).
export function logScrape(
  provider: string,
  query: string,
  result: { status: number; durationMs: number; resultCount: number; cacheHit: boolean }
): void {
  console.log(
    `[scrape] provider=${provider} status=${result.status} ` +
      `dur=${result.durationMs}ms results=${result.resultCount} cache=${result.cacheHit} query="${query.slice(0, 80)}"`
  );
}

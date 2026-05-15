// robots.txt awareness — log-only in v1, no enforcement.
// Fetches and caches the robots.txt for each scraped host. Logs a warning
// when a path we're about to fetch is Disallow'd. This is observation,
// not a block: legal/compliance can later decide to make it a hard gate.

import { getCached, setCached, makeKey } from "@/lib/cache/search-cache";

interface RobotsRules {
  fetchedAt: number;
  disallowedPaths: string[];   // best-effort, for "*" user-agent
}

async function fetchRobots(host: string): Promise<RobotsRules | null> {
  const cacheKey = makeKey(["robots", host]);
  const hit = getCached<RobotsRules>(cacheKey);
  if (hit) return hit;

  try {
    const res = await fetch(`https://${host}/robots.txt`, {
      headers: { "User-Agent": "ProspectAirbnb/1.0 (+compliance check)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    const rules = parseRobots(body);
    setCached(cacheKey, rules, 24 * 60 * 60); // 24h TTL
    return rules;
  } catch {
    return null;
  }
}

function parseRobots(body: string): RobotsRules {
  // Tiny parser: only honour rules under User-agent: * (good enough for logging).
  const disallowed: string[] = [];
  let inStar = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const key = k.toLowerCase();
    if (key === "user-agent") {
      inStar = value === "*";
    } else if (inStar && key === "disallow" && value) {
      disallowed.push(value);
    }
  }
  return { fetchedAt: Date.now(), disallowedPaths: disallowed };
}

export async function logRobotsCheck(targetUrl: string): Promise<void> {
  try {
    const url = new URL(targetUrl);
    const rules = await fetchRobots(url.hostname);
    if (!rules) return;
    const path = url.pathname;
    const hit = rules.disallowedPaths.find((p) => {
      if (p === "/") return true;
      if (p.endsWith("*")) return path.startsWith(p.slice(0, -1));
      return path.startsWith(p);
    });
    if (hit) {
      console.warn(
        `[robots] ${url.hostname}${path} matches Disallow rule "${hit}" for user-agent *. Logged only — not blocking.`
      );
    }
  } catch {
    // never break the calling scrape
  }
}

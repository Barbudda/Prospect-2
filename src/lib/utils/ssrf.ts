import { URL } from "url";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254",
  "metadata.google.internal",
]);

const BLOCKED_SCHEMES = new Set(["file:", "ftp:", "data:", "javascript:"]);

// CIDR ranges blocked: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
function isPrivateIp(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function validatePublicUrl(rawUrl: string): { ok: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  if (BLOCKED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `Blocked URL scheme: ${parsed.protocol}` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: `Blocked hostname: ${hostname}` };
  }

  if (isPrivateIp(hostname)) {
    return { ok: false, error: `Blocked private IP range: ${hostname}` };
  }

  // Block numeric IPv4 embedded in URL without dots
  if (/^\d+$/.test(hostname)) {
    return { ok: false, error: "Blocked raw numeric IP" };
  }

  return { ok: true };
}

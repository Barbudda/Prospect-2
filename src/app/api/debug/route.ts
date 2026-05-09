import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "NOT SET";
  const keyHint = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 40) ?? "NOT SET";
  const svcFull = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "NOT SET";

  // Try to reach search_runs with service role key
  let tableCheck: string;
  try {
    const r = await fetch(`${url}/rest/v1/search_runs?select=id&limit=1`, {
      headers: {
        apikey: svcFull,
        Authorization: `Bearer ${svcFull}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    const body = await r.text();
    tableCheck = `${r.status} ${body.slice(0, 120)}`;
  } catch (e) {
    tableCheck = `ERROR: ${String(e)}`;
  }

  return NextResponse.json({
    supabase_url: url,
    anon_key_prefix: keyHint,
    service_key_full: svcFull,
    search_runs_check: tableCheck,
  });
}

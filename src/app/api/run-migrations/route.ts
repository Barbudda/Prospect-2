import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.MIGRATION_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Bypass self-signed cert chain in Supabase pooler
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });

  try {
    await client.connect();

    await client.query(`
      ALTER TABLE leads
        ADD COLUMN IF NOT EXISTS reconstruction_confidence INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS exclusivity_score          INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS reconstructed              BOOLEAN DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS multi_platform             BOOLEAN DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS platform_count             INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS platforms_found            TEXT[]  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS image_matches              JSONB   DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS duplicate_sources          JSONB   DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS geo_signals                JSONB   DEFAULT NULL;
    `);

    return NextResponse.json({ ok: true, message: "Migration 005 applied" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    await client.end().catch(() => null);
  }
}

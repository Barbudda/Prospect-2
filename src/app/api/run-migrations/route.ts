import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.MIGRATION_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING });

  try {
    await client.connect();

    await client.query(`
      ALTER TABLE leads
        ADD COLUMN IF NOT EXISTS superhost      BOOLEAN DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS review_count   INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS listing_title  TEXT    DEFAULT NULL;
    `);

    return NextResponse.json({ ok: true, message: "Migration 006 applied" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    await client.end().catch(() => null);
  }
}

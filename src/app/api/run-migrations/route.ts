import { NextResponse } from "next/server";
import { Client } from "pg";

export const dynamic = "force-dynamic";

const SQL_004 = `
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opportunity_score    integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS scale_score         integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intent_score        integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimated_property_count integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_team            boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cities_detected     text[];
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_faq             boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_booking_engine  boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_chatbot         boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS automation_level    text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_owner_acquisition_page boolean;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_owner_cta       boolean;
`;

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== "Bearer migrate-intelligence-004") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    return NextResponse.json({ error: "POSTGRES_URL_NON_POOLING not set" }, { status: 500 });
  }
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(SQL_004);
    const check = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name='opportunity_score'"
    );
    return NextResponse.json({ ok: true, verified: check.rows.length > 0 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

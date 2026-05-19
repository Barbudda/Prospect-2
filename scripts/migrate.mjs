import pg from "pg";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_URL =
  process.env.DATABASE_URL ||
  `postgresql://postgres:${process.env.DB_PASSWORD}@db.uwxsfebkcqcehzrkdcsz.supabase.co:5432/postgres`;

const migrations = [
  join(__dirname, "../supabase/migrations/001_initial_schema.sql"),
  join(__dirname, "../supabase/migrations/002_outreach_columns.sql"),
  join(__dirname, "../supabase/migrations/003_leads_status_index.sql"),
  join(__dirname, "../supabase/migrations/004_intelligence_layer.sql"),
  join(__dirname, "../supabase/migrations/005_reconstruction_layer.sql"),
  join(__dirname, "../supabase/migrations/006_individual_hosts.sql"),
  join(__dirname, "../supabase/migrations/007_suppression_list.sql"),
  join(__dirname, "../supabase/migrations/008_email_campaigns.sql"),
  join(__dirname, "../supabase/migrations/009_fix_signup_trigger.sql"),
];

const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log("Connected to database.");

  for (const file of migrations) {
    const sql = readFileSync(file, "utf-8");
    console.log(`Running ${file.split("/").pop()}...`);
    await client.query(sql);
    console.log("  ✓ done");
  }

  console.log("\nAll migrations applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}

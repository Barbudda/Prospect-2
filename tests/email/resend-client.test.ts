import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendOneEmail } from "@/lib/email/resend-client";

// We don't want the test suite to actually call Resend. The wrapper is
// designed to short-circuit with `fatal: true` when RESEND_API_KEY or
// RESEND_FROM_EMAIL are missing — so the no-env path is fully testable
// without mocks. For the "happy path" we'd need to mock the Resend SDK;
// keep the focus here on graceful-failure behaviour, which is what we
// actually want to be sure about for production safety.

const savedEnv = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  RESEND_FROM_NAME: process.env.RESEND_FROM_NAME,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

function clearEnv() {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_FROM_NAME;
  delete process.env.NEXT_PUBLIC_APP_URL;
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("sendOneEmail — graceful failure", () => {
  beforeEach(() => clearEnv());
  afterEach(() => restoreEnv());

  it("fatal-fails when RESEND_API_KEY is missing", async () => {
    const r = await sendOneEmail({
      to: "test@example.com",
      subject: "Hello",
      body: "Hi",
      message_id: "msg-1",
    });
    expect(r.ok).toBe(false);
    expect(r.fatal).toBe(true);
    expect(r.error).toMatch(/RESEND_API_KEY/);
  });

  it("fatal-fails when RESEND_FROM_EMAIL is missing (key present)", async () => {
    process.env.RESEND_API_KEY = "re_dummy_key_for_test";
    const r = await sendOneEmail({
      to: "test@example.com",
      subject: "Hello",
      body: "Hi",
      message_id: "msg-1",
    });
    expect(r.ok).toBe(false);
    expect(r.fatal).toBe(true);
    expect(r.error).toMatch(/RESEND_FROM_EMAIL/);
  });

  // Note: we don't test the actual send-success path here because it
  // requires hitting Resend's API. That's covered by the production
  // smoke test (deploy + send to a real address). The two checks above
  // are what protect us from silent failures when an env var rotates
  // or is forgotten on a fresh project (which is exactly the bug class
  // we hit during the new-Supabase migration).
});

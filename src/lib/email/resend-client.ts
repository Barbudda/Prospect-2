// RESEND CLIENT — single entry point for outbound email.
//
// All sending paths in the app go through `sendOneEmail`. It enforces:
//   - SPF/DKIM-aligned `from` address (set RESEND_FROM_EMAIL in env)
//   - GDPR-mandated unsubscribe footer + List-Unsubscribe header (RFC 2369)
//   - Tagging so the webhook can reconcile events back to email_messages
//
// The Resend SDK throws on bad keys / 5xx — we wrap that in a typed
// result so callers can decide retry vs. mark-failed without juggling
// exceptions.

import { Resend } from "resend";

let cached: Resend | null = null;

function client(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

export interface SendOptions {
  to: string;
  to_name?: string;
  subject: string;
  /** Plain text body. We let Resend auto-derive HTML if `html` is not set. */
  body: string;
  /** Optional HTML body. If provided, body is sent as the plain-text alt. */
  html?: string;
  /** Caller-supplied unique id used for webhook reconciliation. */
  message_id: string;
  /** Optional override of the configured from address. */
  from?: string;
  from_name?: string;
  reply_to?: string;
}

export interface SendResult {
  ok: boolean;
  resend_id?: string;
  error?: string;
  // Non-retryable: bad key, banned recipient, etc.
  fatal?: boolean;
}

const UNSUB_FOOTER_PLAIN = (unsubUrl: string) => `

—
This is a one-off outreach from Prospect. If you'd rather not be
contacted, unsubscribe here: ${unsubUrl}
You can also reply STOP and we'll suppress your address immediately.`;

const UNSUB_FOOTER_HTML = (unsubUrl: string) => `
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px"/>
<p style="font-size:12px;color:#6b7280;line-height:1.5">
  This is a one-off outreach from Prospect.
  <a href="${unsubUrl}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a> if you'd rather not be contacted.
  You can also reply STOP and we'll suppress your address immediately.
</p>`;

export async function sendOneEmail(opts: SendOptions): Promise<SendResult> {
  const c = client();
  if (!c) {
    return { ok: false, error: "RESEND_API_KEY not configured", fatal: true };
  }

  const fromEmail = opts.from ?? process.env.RESEND_FROM_EMAIL;
  const fromName = opts.from_name ?? process.env.RESEND_FROM_NAME ?? "Prospect";
  if (!fromEmail) {
    return { ok: false, error: "RESEND_FROM_EMAIL not configured", fatal: true };
  }

  // Build a per-message unsubscribe link the webhook + the user can honour.
  const appBase = process.env.NEXT_PUBLIC_APP_URL ?? "https://prospect-2.vercel.app";
  const unsubUrl = `${appBase}/api/email/unsubscribe?mid=${encodeURIComponent(opts.message_id)}`;

  const text = `${opts.body}${UNSUB_FOOTER_PLAIN(unsubUrl)}`;
  const html = opts.html ? `${opts.html}${UNSUB_FOOTER_HTML(unsubUrl)}` : undefined;

  try {
    const result = await c.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: opts.to_name ? [`${opts.to_name} <${opts.to}>`] : [opts.to],
      subject: opts.subject,
      text,
      html,
      replyTo: opts.reply_to,
      // List-Unsubscribe is *the* deliverability lever for cold outbound.
      // Gmail/Outlook check it before classifying as spam.
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>, <mailto:unsubscribe@${(fromEmail.split("@")[1] ?? "")}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [
        { name: "app", value: "prospect" },
        { name: "message_id", value: opts.message_id.slice(0, 64) },
      ],
    });

    if (result.error) {
      // Resend SDK returns errors in a structured `error` field rather
      // than throwing for known cases (bad recipient, etc.). Treat
      // permission/validation errors as fatal so we don't retry forever.
      const msg = result.error.message ?? "Resend error";
      const fatal = /validation|invalid|forbidden|unauthorized|suppressed/i.test(msg);
      return { ok: false, error: msg, fatal };
    }

    return { ok: true, resend_id: result.data?.id ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network / SDK error";
    return { ok: false, error: message, fatal: false };
  }
}

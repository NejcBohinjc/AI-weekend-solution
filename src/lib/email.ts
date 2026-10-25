// Outgoing email over SMTP (any provider: Gmail/Google Workspace, Outlook, Brevo, Mailgun, ...).
// Without SMTP_HOST nothing is sent: the email is only recorded in email_log as "logged", so the
// app works (and admins can see what would have gone out) before email is set up.
// MAIL_REDIRECT_TO sends every email to one address instead, for demos and testing.
import nodemailer, { type Transporter } from "nodemailer";
import { db } from "@/db";
import { emailLog } from "@/db/schema";
import type { EmailStatus } from "@/lib/meetings/constants";

export type OutgoingEmail = { memberId: number | null; to: string; subject: string; text: string; html: string };

export function emailSettings() {
  return {
    sending: Boolean(process.env.SMTP_HOST),
    from: process.env.MAIL_FROM || process.env.SMTP_USER || null,
    redirectTo: process.env.MAIL_REDIRECT_TO || null,
  };
}

/** Every network step of an email gives up after this long (a slow server must not hold a request or a job). */
export function smtpTimeoutMs(): number {
  return Number(process.env.SMTP_TIMEOUT_MS) || 10_000;
}

let transporter: { key: string; transport: Transporter } | null = null;
function transport(): Transporter {
  const port = Number(process.env.SMTP_PORT || 587);
  const timeout = smtpTimeoutMs();
  const key = `${process.env.SMTP_HOST}:${port}:${process.env.SMTP_USER}:${timeout}`;
  if (transporter?.key !== key) {
    transporter = {
      key,
      transport: nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        connectionTimeout: timeout,
        greetingTimeout: timeout,
        socketTimeout: timeout,
        dnsTimeout: timeout,
      }),
    };
  }
  return transporter.transport;
}

/** Sends (or, without SMTP, only records) one email. Never throws; the result says what happened. */
export async function sendEmail(mail: OutgoingEmail): Promise<{ id: number; status: EmailStatus; error?: string; to: string }> {
  const { sending, from, redirectTo } = emailSettings();
  const to = redirectTo ?? mail.to;
  let status: EmailStatus = "logged";
  let error: string | undefined;
  if (sending) {
    try {
      await transport().sendMail({ from: from ?? undefined, to, subject: mail.subject, text: mail.text, html: mail.html });
      status = "sent";
    } catch (err) {
      status = "failed";
      const code = (err as { code?: string }).code;
      error = `${(err as Error).message}${code ? ` (${code})` : ""}`;
      console.error("[email]", to, error);
    }
  } else {
    console.info(`[email] not sent (SMTP_HOST is not set): to ${to}: ${mail.subject}`);
  }
  const [row] = await db
    .insert(emailLog)
    .values({ memberId: mail.memberId, to, subject: mail.subject, body: mail.text, status, error })
    .returning({ id: emailLog.id });
  return { id: row.id, status, error, to };
}

/** One test message to the current admin (or MAIL_REDIRECT_TO, which sendEmail applies): shows the exact error if SMTP is wrong. */
export async function sendTestEmail(admin: { id: number; name: string; email: string }) {
  const stamp = new Date().toISOString();
  return sendEmail({
    memberId: admin.id,
    to: admin.email,
    subject: "Test email from Shapers Hub",
    text: `Hello ${admin.name},\n\nthis is a test email from Shapers Hub, sent ${stamp}. If you can read it, sending reminders works.`,
    html: `<p>Hello ${admin.name.replace(/[<&>]/g, "")},</p><p>this is a test email from Shapers Hub, sent ${stamp}. If you can read it, sending reminders works.</p>`,
  });
}

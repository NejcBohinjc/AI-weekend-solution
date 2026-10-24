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

let transporter: Transporter | null = null;
function transport(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/** Sends (or, without SMTP, only records) one email. Never throws; the result says what happened. */
export async function sendEmail(mail: OutgoingEmail): Promise<{ id: number; status: EmailStatus; error?: string }> {
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
      error = (err as Error).message;
      console.error("[email]", to, error);
    }
  } else {
    console.info(`[email] not sent (SMTP_HOST is not set): to ${to}: ${mail.subject}`);
  }
  const [row] = await db
    .insert(emailLog)
    .values({ memberId: mail.memberId, to, subject: mail.subject, body: mail.text, status, error })
    .returning({ id: emailLog.id });
  return { id: row.id, status, error };
}

/**
 * Email transport — pluggable. Dev default: log the email body + verification
 * link to the server console (so you can copy/paste from your dev terminal).
 * Production: set `SMTP_URL` and the same call sends via nodemailer.
 *
 * Kept tiny on purpose. Anything fancier (templates, providers like Resend or
 * Postmark) plugs into `send()` without touching callers.
 */
import { createHash } from "crypto";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(msg: OutgoingEmail): Promise<void> {
  const smtpUrl = process.env.SMTP_URL;
  if (smtpUrl) {
    // Lazy import via a string-typed module specifier so TypeScript doesn't
    // require @types/nodemailer to be installed. To enable real email in
    // production: set SMTP_URL and run `npm i nodemailer`.
    const moduleName = "nodemailer";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(moduleName).catch(() => null);
    if (!mod) {
      console.warn(
        "[bet email] SMTP_URL is set but nodemailer is not installed — `npm i nodemailer` to enable.",
      );
    } else {
      const transport = mod.createTransport(smtpUrl);
      await transport.sendMail({
        from: process.env.EMAIL_FROM ?? "Bet <noreply@bet.local>",
        ...msg,
      });
      return;
    }
  }
  // Dev fallback: emit a clearly-labelled block so devs can spot the link in
  // the terminal noise of the Next.js server output.
  console.log(
    "\n📬 [bet email]" +
      `\n   to:      ${msg.to}` +
      `\n   subject: ${msg.subject}` +
      `\n   ${msg.text.replace(/\n/g, "\n   ")}\n`,
  );
}

/**
 * Hash a verification token for storage. Plain SHA-256 — the token only
 * needs to be opaque-on-leak; full bcrypt would be overkill for a 24h TTL.
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Cryptographically-random hex token. 32 bytes → 64 hex chars. */
export function makeToken(): string {
  // Web Crypto is available in Node 20+.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

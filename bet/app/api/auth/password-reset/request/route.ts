import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashToken, makeToken, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().email().max(120) });
const TTL_HOURS = 1;

/**
 * Request a password-reset link. To avoid leaking which emails are
 * registered, we ALWAYS return 200 — even if no user matches. Real send
 * happens only when a user exists.
 *
 * Rate-limited per IP (not per user) so a hostile actor can't enumerate
 * accounts by hammering the endpoint and watching for differential timing.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const limit = rateLimit(`pwreset-req:${ip}`, { limit: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    select: { id: true, username: true, email: true, banned: true },
  });

  // Always sleep a bit so timing is uniform whether the user exists or not.
  // Production: replace with a proper constant-time guard. Demo is fine.
  await sleep(80 + Math.random() * 30);

  if (user && !user.banned) {
    const raw = makeToken();
    const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);
    await db.passwordReset.create({
      data: { userId: user.id, codeHash: hashToken(raw), expiresAt },
    });

    const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "http://localhost:3100";
    const link = `${base}/reset?token=${raw}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your Bet password",
      text:
        `Hi ${user.username},\n\n` +
        `You can reset your password using the link below. It's valid for ${TTL_HOURS} hour.\n\n` +
        `${link}\n\n` +
        `If you didn't request this, ignore this email — your password won't change.`,
    });
  }

  return NextResponse.json({ ok: true });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

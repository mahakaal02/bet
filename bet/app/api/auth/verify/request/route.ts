import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { hashToken, makeToken, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

const TTL_HOURS = 24;

/**
 * Generate a verification token, hash + store it, email the recipient a link.
 * Existing unconsumed tokens for this user are NOT invalidated — multiple
 * outstanding tokens are fine, the one that gets clicked first wins.
 */
export async function POST() {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = rateLimit(`verify-req:${u.id}`, { limit: 3, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const user = await db.user.findUnique({
    where: { id: u.id },
    select: { email: true, emailVerified: true, username: true },
  });
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (user.emailVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  const raw = makeToken();
  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);
  await db.emailVerification.create({
    data: {
      userId: u.id,
      codeHash: hashToken(raw),
      expiresAt,
    },
  });

  const base =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
    "http://localhost:3100";
  const link = `${base}/verify?token=${raw}`;

  await sendEmail({
    to: user.email,
    subject: "Verify your Bet email",
    text:
      `Hi ${user.username},\n\n` +
      `Click below to verify your email. The link is valid for ${TTL_HOURS} hours.\n\n` +
      `${link}\n\n` +
      `If you didn't request this, ignore the email.`,
  });

  return NextResponse.json({ ok: true });
}

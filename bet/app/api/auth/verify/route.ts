import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/email";

const Body = z.object({ token: z.string().min(32).max(128) });

/**
 * Consume a verification token. Single-use: marks `consumedAt` after a
 * successful verification so a replayed link is rejected. Expired tokens
 * (>24h) are also rejected.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const codeHash = hashToken(parsed.data.token);
  const row = await db.emailVerification.findFirst({
    where: { codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!row) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 400 });
  }

  await db.$transaction([
    db.emailVerification.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    }),
    db.user.update({
      where: { id: row.userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    }),
    db.notification.create({
      data: {
        userId: row.userId,
        title: "Email verified ✅",
        body: "Your email is confirmed. Thanks!",
        href: "/profile",
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(8).max(100),
});

/**
 * Consume a reset token and replace the user's password hash. Single-use,
 * 1h TTL. After success we ALSO invalidate any other outstanding reset
 * tokens for the same user (so a leaked second link from an attacker can't
 * be reused after the legitimate user has reset).
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const limit = rateLimit(`pwreset:${ip}`, { limit: 10, windowMs: 60 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const codeHash = hashToken(parsed.data.token);
  const row = await db.passwordReset.findFirst({
    where: { codeHash, consumedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { select: { email: true } } },
  });
  if (!row) {
    return NextResponse.json({ error: "invalid_or_expired" }, { status: 400 });
  }

  const passwordHash = await hash(parsed.data.password, 10);

  await db.$transaction([
    db.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    db.passwordReset.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    }),
    // Invalidate any other outstanding reset tokens. Setting consumedAt is
    // enough — they'll fail the WHERE filter on the next lookup.
    db.passwordReset.updateMany({
      where: {
        userId: row.userId,
        consumedAt: null,
        id: { not: row.id },
      },
      data: { consumedAt: new Date() },
    }),
    db.notification.create({
      data: {
        userId: row.userId,
        title: "Password changed",
        body: "Your Kalki Exchange password was just reset. If this wasn't you, contact support.",
        href: "/profile",
      },
    }),
  ]);

  // Echo the email back so the client can drop straight into an auto-signin
  // call without a second round-trip. The raw password stays on the client.
  return NextResponse.json({ ok: true, email: row.user.email });
}

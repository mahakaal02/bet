import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { signupCoins } from "@/lib/coins";
import { rateLimit } from "@/lib/rate-limit";
import { onReferral } from "@/lib/achievements";

const Body = z.object({
  email: z.string().email().max(120),
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/i, "letters, digits or underscore only"),
  password: z.string().min(8).max(100),
  referralCode: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const limit = rateLimit(`register:${ip}`, { limit: 5, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, username, password, referralCode } = parsed.data;

  const conflict = await db.user.findFirst({
    where: {
      OR: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
    },
    select: { id: true, email: true, username: true },
  });
  if (conflict) {
    return NextResponse.json(
      {
        error: conflict.email === email.toLowerCase() ? "email_taken" : "username_taken",
      },
      { status: 409 },
    );
  }

  const passwordHash = await hash(password, 10);
  const bonus = signupCoins();

  let referredById: string | null = null;
  if (referralCode) {
    const ref = await db.user.findUnique({
      where: { referralCode: referralCode.toUpperCase() },
      select: { id: true },
    });
    referredById = ref?.id ?? null;
  }

  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      passwordHash,
      referredById,
      referralCode: makeReferralCode(),
      wallet: { create: { balance: bonus } },
      txns: {
        create: {
          delta: bonus,
          kind: "signup_bonus",
          reference: `signup:${email.toLowerCase()}`,
        },
      },
    },
    select: { id: true, username: true, email: true },
  });

  // Referral bonus — credit referrer (idempotent on referral:<newUserId>).
  if (referredById) {
    const refBonus = 500;
    await db.$transaction([
      db.wallet.update({
        where: { userId: referredById },
        data: { balance: { increment: refBonus } },
      }),
      db.transaction.create({
        data: {
          userId: referredById,
          delta: refBonus,
          kind: "referral_bonus",
          reference: `referral:${user.id}`,
        },
      }),
    ]).catch(() => undefined);
    await onReferral(referredById).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, user });
}

function makeReferralCode(): string {
  // 6-character alphanumeric, exclude ambiguous chars.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

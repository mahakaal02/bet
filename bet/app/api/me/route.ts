import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";

export async function GET() {
  const u = await getAuthedUser();
  if (!u) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [user, wallet] = await Promise.all([
    db.user.findUnique({
      where: { id: u.id },
      select: {
        id: true,
        username: true,
        email: true,
        image: true,
        isAdmin: true,
        xp: true,
        level: true,
        streak: true,
        lastClaimAt: true,
        referralCode: true,
        createdAt: true,
      },
    }),
    db.wallet.findUnique({
      where: { userId: u.id },
      select: { balance: true },
    }),
  ]);

  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    user,
    wallet: wallet ?? { balance: 0 },
  });
}

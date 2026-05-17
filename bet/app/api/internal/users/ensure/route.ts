import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkInternalSecret } from "@/lib/internal-auth";
import { logger } from "@/lib/logger";

const Body = z.object({
  email: z.string().email().max(120),
  /**
   * Preferred username for the freshly-created Bet user. If it conflicts
   * we suffix `-2`, `-3`, etc. Server normalises to lowercase + [a-z0-9_]
   * before persisting, matching the registration regex.
   */
  username: z.string().min(1).max(60),
});

/**
 * Identity bridge for the unified wallet.
 *
 * Auctions backend + Aviator both call this on user signup / first wallet
 * operation. Behaviour:
 *
 *   - Bet user already exists for `email` → return their id (idempotent).
 *   - Otherwise → create one with passwordHash=null (cannot log in via
 *     credentials, but the row exists for wallet bookkeeping), email
 *     pre-verified (the caller already vouched), and a starter wallet.
 *
 * No signup bonus on this path. Backfilling a user's existing balance
 * from the calling app is the caller's responsibility — it sends a
 * `credit` to /api/internal/wallet once it has the betUserId.
 *
 *   POST /api/internal/users/ensure
 *   Authorization: Bearer <INTERNAL_API_SECRET>
 *   { email, username }
 *
 *   → 200 { ok, userId, username, created }
 */
export async function POST(req: Request) {
  const auth = checkInternalSecret(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  try {
    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true, username: true },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        userId: existing.id,
        username: existing.username,
        created: false,
      });
    }

    // Sanitise the requested username + iterate on a numeric suffix until
    // the unique index accepts it. Keeps a single user with a sensible
    // handle even if "kumar" / "kumar2" / "kumar3" exist elsewhere.
    const base = parsed.data.username
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "")
      .slice(0, 18) || `user${Math.floor(Math.random() * 9999)}`;
    let chosen = base;
    let i = 0;
    // 50 attempts is a defensive cap — duplicate prefixes basically never
    // happen at our scale. Past that we just bail with a 503.
    while (i < 50 && (await db.user.findUnique({ where: { username: chosen } }))) {
      i += 1;
      chosen = `${base}${i + 1}`.slice(0, 20);
    }
    if (i >= 50) {
      return NextResponse.json({ error: "username_collision" }, { status: 503 });
    }

    const user = await db.user.create({
      data: {
        email,
        username: chosen,
        passwordHash: null,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        // Empty wallet. Caller backfills via /api/internal/wallet credit.
        wallet: { create: { balance: 0 } },
      },
      select: { id: true, username: true },
    });

    return NextResponse.json({
      ok: true,
      userId: user.id,
      username: user.username,
      created: true,
    });
  } catch (e) {
    logger.error(e, { route: "/api/internal/users/ensure", email });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

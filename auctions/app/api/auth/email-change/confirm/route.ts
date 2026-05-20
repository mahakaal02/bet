import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * POST /api/auth/email-change/confirm
 *
 * UNAUTHED route — the token IS the auth. Forwards to the backend's
 * /auth/email-change/confirm endpoint, which 200s on either
 * single-side confirmation or full apply.
 */

const Body = z.object({
  token: z.string().min(1).max(256),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Token is required." },
      { status: 400 },
    );
  }

  try {
    const result = await fetch(
      `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/auth/email-change/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );
    if (!result.ok) {
      let message = "This link is invalid or expired.";
      try {
        const body = await result.json();
        if (typeof body?.message === "string") message = body.message;
      } catch {
        /* keep default */
      }
      return NextResponse.json({ message }, { status: result.status });
    }
    return NextResponse.json(await result.json());
  } catch {
    return NextResponse.json(
      { message: "Couldn't reach the auctions service — try again." },
      { status: 502 },
    );
  }
}

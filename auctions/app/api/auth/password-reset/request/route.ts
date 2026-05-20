import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * POST /api/auth/password-reset/request
 *
 * Thin proxy to the backend's `/auth/password-reset/request`. Forwards
 * the email along with the originating IP (via `x-forwarded-for`) so
 * the backend rate-limiter can attribute correctly.
 *
 * Always returns 200 with the same body shape regardless of whether
 * the email exists or not — the backend handles the
 * account-enumeration resistance and the form just renders a generic
 * "if your email is registered, we've sent a link" message.
 */

const Body = z.object({
  email: z.string().email().max(320),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Please enter a valid email." },
      { status: 400 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";

  try {
    const result = await fetch(
      `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/auth/password-reset/request`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Preserve the originating IP so the backend's per-IP
          // rate-limiter sees the real client.
          ...(ip ? { "X-Forwarded-For": ip } : {}),
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );
    if (result.status === 429) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Too many reset attempts — please wait a few minutes and try again.",
        },
        { status: 429 },
      );
    }
    // Any other non-200 → still surface a generic success to keep
    // account-enumeration resistance. Log to the server for ops.
    if (!result.ok) {
      console.warn(
        `password-reset/request: backend returned ${result.status}`,
      );
    }
  } catch (err) {
    console.warn(
      `password-reset/request: backend unreachable: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  // Always 200 to the client. The page renders the same "we sent
  // a link" message either way.
  return NextResponse.json({ ok: true });
}

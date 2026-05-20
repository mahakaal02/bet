import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * POST /api/auth/password-reset/confirm
 *
 * Forwards `{token, newPassword}` to the backend's
 * `/auth/password-reset/confirm`. Returns:
 *
 *   - 200 on success
 *   - 400 on bad token / expired / used / too-short password
 *     (the backend collapses these failure modes into a single
 *     400 to avoid leaking which one tripped)
 *   - 429 if the user is hammering the confirm endpoint
 *
 * No session is set here — the user is sent back to /login after
 * a successful reset, by design, since every existing JWT for the
 * account is invalidated by the password change.
 */

const Body = z.object({
  token: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";

  try {
    const result = await fetch(
      `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/auth/password-reset/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ip ? { "X-Forwarded-For": ip } : {}),
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );
    if (!result.ok) {
      let message =
        result.status === 429
          ? "Too many attempts — please wait a few minutes."
          : "This reset link is invalid or expired. Please request a new one.";
      try {
        const body = await result.json();
        if (typeof body?.message === "string") message = body.message;
      } catch {
        /* keep default */
      }
      return NextResponse.json(
        { ok: false, message },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        message:
          err instanceof Error
            ? "Couldn't reach the auctions service — please try again."
            : "Unknown error.",
      },
      { status: 502 },
    );
  }
}

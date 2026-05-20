import { NextResponse } from "next/server";
import { z } from "zod";
import { type LoginResponse } from "@/lib/backend";
import { setSessionToken } from "@/lib/session";

/**
 * POST /api/auth/login-2fa
 *
 * Step 2 of the 2FA login. Forwards `{ challengeToken, code }` to
 * the backend's `/auth/login/2fa` endpoint. On success the response
 * mirrors the normal login: `{ token, user }`. We stash the token
 * in the session cookie exactly the same way.
 */

const Body = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(1).max(32),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Code is required." },
      { status: 400 },
    );
  }

  try {
    const result = await fetch(
      `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/auth/login/2fa`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );
    if (!result.ok) {
      const text = await result.text();
      let message = "Invalid code. Try again.";
      try {
        const body = JSON.parse(text);
        message = Array.isArray(body?.message)
          ? body.message.join("; ")
          : body?.message ?? message;
      } catch {
        /* keep default */
      }
      return NextResponse.json(
        { ok: false, message },
        { status: result.status },
      );
    }
    const data = (await result.json()) as LoginResponse;
    await setSessionToken(data.token);
    return NextResponse.json({
      ok: true,
      username: data.user.username,
      isAdmin: data.user.isAdmin,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Couldn't reach the auctions service — please try signing in again.",
      },
      { status: 502 },
    );
  }
}

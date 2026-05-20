import { NextResponse } from "next/server";
import { z } from "zod";
import { BackendApiError, type LoginResponse } from "@/lib/backend";
import {
  getTrustedDeviceToken,
  setSessionToken,
} from "@/lib/session";

/**
 * POST /api/auth/login
 *
 * Thin proxy: takes `{email, password}`, calls the auctions backend's
 * `/auth/login` endpoint, and if it returns a JWT we stash it in an
 * HTTP-only cookie. The client never sees the token directly — server
 * components read it via `getSessionToken()`.
 *
 * Errors are passed through with a normalised shape so the login form
 * can render `body.message` without inspecting NestJS's nesting.
 */
const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Email and password required." },
      { status: 400 },
    );
  }

  // Pass the long-lived trusted-device cookie (if present) as a
  // header so the backend can decide to skip the 2FA prompt for
  // this browser. Reading the cookie HERE means the JS bundle
  // never sees it — it stays httpOnly end-to-end.
  const trustedDeviceToken = await getTrustedDeviceToken();

  try {
    // The backend's controller exposes `/auth/login` with `{email,
    // password}` and returns `{token, user}` — see auth.controller.ts.
    const result = await fetch(
      `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/auth/login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(trustedDeviceToken
            ? { "X-Kalki-Trusted-Device": trustedDeviceToken }
            : {}),
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );
    if (!result.ok) {
      const text = await result.text();
      let message = "Invalid email or password.";
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
        { status: result.status === 401 ? 401 : result.status },
      );
    }
    const raw = (await result.json()) as Record<string, unknown>;

    // 2FA challenge: don't set the session yet. Hand the challenge
    // token back to the client; it'll collect the code and POST to
    // /api/auth/login-2fa to complete the flow.
    if (raw.needs2FA === true && typeof raw.challengeToken === "string") {
      return NextResponse.json({
        ok: true,
        needs2FA: true,
        challengeToken: raw.challengeToken,
      });
    }

    const data = raw as unknown as LoginResponse;
    await setSessionToken(data.token);
    return NextResponse.json({
      ok: true,
      username: data.user.username,
      isAdmin: data.user.isAdmin,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        message:
          err instanceof BackendApiError
            ? err.message
            : "Couldn't reach the auctions service — is the backend up on :4000?",
      },
      { status: 502 },
    );
  }
}


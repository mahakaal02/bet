import { NextResponse } from "next/server";
import { z } from "zod";
import { BackendApiError, type LoginResponse } from "@/lib/backend";
import { setSessionToken } from "@/lib/session";

/**
 * POST /api/auth/register
 *
 * Thin proxy: takes `{email, password}` from the hub's signup form,
 * forwards to the auctions backend's `/auth/register`, and (on
 * success) stashes the returned JWT in the same HTTP-only cookie
 * the login proxy uses. Mirrors `app/api/auth/login/route.ts`
 * structure so the client side sees the same `{ok, message}`
 * envelope across the two flows.
 *
 * Username is omitted from the request body — the backend
 * (`AuthService.register::allocateUsernameForEmail`) derives one
 * from the email's local part with a collision-breaker suffix.
 * The hub's signup card collects only email + password by design,
 * matching the Telegram flow's "no extra identifier required"
 * philosophy.
 */
const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    // First validation error is enough — the form has only two
    // fields, and showing the most-specific issue keeps the UI
    // honest.
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        ok: false,
        message: issue?.message ?? "Email and password required.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await fetch(
      `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/auth/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );

    if (!result.ok) {
      const text = await result.text();
      let message = "Couldn't create your account. Try again?";
      try {
        const body = JSON.parse(text);
        // NestJS `ConflictException` (P2002 on email/username) lands
        // here as 409 with `message: 'email or username already in
        // use'`. class-validator failures arrive as 400 with an
        // array of messages — surface the first as a single string
        // so the form can render it cleanly.
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

    // Successful signup returns the same `{token, user}` envelope as
    // login — including the user newly minted. Set the session
    // cookie and signal success to the client. There's no 2FA
    // branch on the signup path (fresh accounts have no 2FA set up
    // yet), so we always land on the immediate-success shape.
    const data = (await result.json()) as LoginResponse;
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

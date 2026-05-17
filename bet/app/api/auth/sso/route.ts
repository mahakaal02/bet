import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { signupCoins } from "@/lib/coins";
import { isBackendBridgeEnabled, verifyBackendJwt } from "@/lib/backend-jwt";

export const runtime = "nodejs";

/**
 * Universal SSO landing for Bet. The middleware diverts any request
 * carrying `?token=…` here, so this route handler is the single place
 * that knows how to convert a backend JWT into a Bet session:
 *
 *   1. Verify the JWT's HMAC against `BACKEND_JWT_SECRET`.
 *   2. Find or provision a Bet User row keyed on the JWT's email.
 *   3. Mint a NextAuth session token via `next-auth/jwt`'s `encode` —
 *      the payload shape mirrors what `auth.ts::jwt` callback would
 *      produce, so server routes that read `getServerSession` see a
 *      normal session.
 *   4. Set the session cookie + 303 to the `?next=` URL.
 *
 * Failure modes (bad signature, expired token, banned user, etc.)
 * silently fall through to /login — never leak why.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const nextParam = url.searchParams.get("next") ?? "/";
  // Defensive: only follow local same-origin redirects so a forged URL
  // can't pivot the user to a phishing host.
  const safeNext = nextParam.startsWith("/") ? nextParam : "/";
  const failureRedirect = NextResponse.redirect(new URL("/login", req.url));

  if (!token || !isBackendBridgeEnabled()) return failureRedirect;

  let payload;
  try {
    payload = await verifyBackendJwt(token);
  } catch {
    return failureRedirect;
  }
  if (!payload.email) return failureRedirect;

  // Find or provision the Bet shadow user (same logic the
  // CredentialsProvider in auth.ts uses; duplicated here because the
  // middleware path doesn't go through NextAuth's authorize()).
  const email = payload.email.toLowerCase();
  let local = await db.user.findUnique({ where: { email } });
  if (!local) {
    const baseUsername =
      payload.username
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 20) || `user${Math.floor(Math.random() * 9999)}`;
    let username = baseUsername;
    let i = 0;
    while (await db.user.findUnique({ where: { username } })) {
      i += 1;
      username = `${baseUsername}${i}`;
    }
    local = await db.user.create({
      data: {
        email,
        username,
        wallet: { create: { balance: signupCoins() } },
        txns: {
          create: {
            delta: signupCoins(),
            kind: "signup_bonus",
            reference: `signup:${email}`,
          },
        },
      },
    });
  } else if (local.banned) {
    return failureRedirect;
  }

  // Build the NextAuth JWT payload. Field names mirror what the `jwt`
  // callback in `lib/auth.ts` puts on `token` — `uid`, `username`,
  // `isAdmin`, `picture` for app-level reads; `sub`/`email`/`name`/
  // `picture` for NextAuth internals. The `iat`/`exp`/`jti` are added
  // by `encode`.
  const sessionMaxAgeSec = 30 * 24 * 60 * 60;
  const sessionJwt = await encode({
    token: {
      sub: local.id,
      email: local.email,
      name: local.username,
      picture: local.image ?? null,
      uid: local.id,
      username: local.username,
      isAdmin: local.isAdmin,
      backendUserId: payload.sub,
      backendUsername: payload.username,
    },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: sessionMaxAgeSec,
  });

  // NextAuth's default cookie name is `next-auth.session-token`;
  // production HTTPS deployments prefix it with `__Secure-`.
  const isSecure = process.env.NODE_ENV === "production";
  const cookieName = isSecure
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";

  const res = NextResponse.redirect(new URL(safeNext, req.url));
  res.cookies.set(cookieName, sessionJwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: sessionMaxAgeSec,
  });
  return res;
}

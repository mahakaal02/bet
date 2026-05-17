/**
 * Verifies HS256 JWTs minted by the auctions backend.
 *
 * The Android app passes the user's backend JWT to Bet as `?token=…` when
 * opening the WebView (see `TokenBridge.tsx`). Bet trusts the token if and
 * only if the HMAC matches the shared secret `BACKEND_JWT_SECRET` — which
 * is the same string the backend uses as `JWT_SECRET`.
 *
 * Why `jose` and not `jsonwebtoken`: jose ships with WebCrypto, works inside
 * Next.js' edge runtime, and is already a transitive dep of next-auth so we
 * don't add bundle weight.
 *
 * Returns the decoded payload on success, throws on any failure (expired,
 * bad signature, missing claims). Callers should treat any throw as
 * "untrusted token; reject sign-in" — never log the raw token.
 */
import { jwtVerify } from "jose";

export interface BackendJwtPayload {
  /** Backend's User.id (uuid). */
  sub: string;
  /** Backend's User.username — used as fallback if the email-keyed lookup misses. */
  username: string;
  /** Set when the backend account was created via email signup. */
  email?: string | null;
  /** Set when the backend account was created via WhatsApp signup. */
  phone?: string | null;
  iat?: number;
  exp?: number;
}

let cachedSecret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.BACKEND_JWT_SECRET;
  if (!raw) {
    throw new Error(
      "BACKEND_JWT_SECRET is not configured on Bet. Set it to the same value " +
        "as the auctions backend's JWT_SECRET to enable the SSO bridge.",
    );
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

export function isBackendBridgeEnabled(): boolean {
  return !!process.env.BACKEND_JWT_SECRET;
}

export async function verifyBackendJwt(token: string): Promise<BackendJwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("backend JWT missing sub claim");
  }
  if (typeof payload.username !== "string" || !payload.username) {
    throw new Error("backend JWT missing username claim");
  }
  return {
    sub: payload.sub,
    username: payload.username,
    email:
      typeof payload.email === "string" && payload.email.length > 0
        ? payload.email.toLowerCase()
        : null,
    phone:
      typeof payload.phone === "string" && payload.phone.length > 0
        ? payload.phone
        : null,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}

import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { db } from "@/lib/db";
import { signupCoins } from "@/lib/coins";
import {
  isBackendBridgeEnabled,
  verifyBackendJwt,
} from "@/lib/backend-jwt";

const useGoogle =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

/**
 * Where the auctions backend lives (for delegated credential auth). Bet
 * no longer authenticates against its own User table — `passwordHash`
 * is left over from before the unified-DB rollout and is intentionally
 * ignored on the credentials path.
 */
const BACKEND_URL = (
  process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

interface BackendLoginResponse {
  token: string;
  user: {
    id: string;
    email: string | null;
    username: string;
    isAdmin: boolean;
    emailVerified: boolean;
  };
}

/**
 * Validate `email + password` against the auctions backend. Returns the
 * decoded user info on success, `null` on any failure — NextAuth treats
 * `null` as "invalid credentials" and shows the generic login error.
 *
 * Why delegate: there's now one source of truth for user identity
 * (the auctions backend). Bet keeps a User row only as a wallet anchor;
 * its `passwordHash` column is unused on the credentials path.
 */
async function loginViaBackend(
  email: string,
  password: string,
): Promise<BackendLoginResponse | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as BackendLoginResponse;
  } catch {
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Credentials path delegates to the auctions backend so all three
        // product surfaces (Auctions, Bet, Aviator) share one user DB.
        // Bet's local User table is only a wallet anchor — its row is
        // ensured below (and on every wallet operation via the internal
        // /api/internal/users/ensure path).
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.toLowerCase();
        let upstream = await loginViaBackend(email, credentials.password);

        // PR-BET-HOTFIX-LOCAL-AUTH — fallback path for environments
        // where the auctions backend isn't reachable (local dev without
        // the Nest backend, or a temporary outage). Checks the local
        // `User.passwordHash` column (populated by /api/register) via
        // bcrypt compare. Production normally routes via the backend
        // and never touches this branch; when the backend IS up,
        // `upstream` is non-null and we skip the fallback entirely.
        if (!upstream && process.env.ALLOW_LOCAL_PASSWORD_AUTH !== "false") {
          try {
            const local = await db.user.findUnique({ where: { email } });
            if (local?.passwordHash) {
              const { compare } = await import("bcryptjs");
              const ok = await compare(credentials.password, local.passwordHash);
              if (ok && !local.banned) {
                // Synthesize the upstream shape so the rest of the
                // function flows identically. `isAdmin` comes off the
                // local User row.
                upstream = {
                  token: "",
                  user: {
                    id: local.id,
                    email: local.email,
                    username: local.username,
                    isAdmin: local.isAdmin,
                    emailVerified: local.emailVerified,
                  },
                };
              }
            }
          } catch {
            /* DB blip — fall through to the upstream=null return */
          }
        }

        if (!upstream) return null;

        // Ensure / hydrate the Bet shadow user, just like the Google
        // OAuth branch in `signIn` below does. Username collisions are
        // resolved with a numeric suffix so we never reject the sign-in.
        let local = await db.user.findUnique({ where: { email } });
        if (!local) {
          let username = upstream.user.username;
          let i = 0;
          while (await db.user.findUnique({ where: { username } })) {
            i += 1;
            username = `${upstream.user.username}${i}`;
          }
          local = await db.user.create({
            data: {
              email,
              username,
              isAdmin: upstream.user.isAdmin,
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
          return null;
        } else if (local.isAdmin !== upstream.user.isAdmin) {
          // Keep admin flag in lock-step with the backend's view.
          await db.user.update({
            where: { id: local.id },
            data: { isAdmin: upstream.user.isAdmin },
          });
        }
        return {
          id: local.id,
          email: local.email,
          name: local.username,
          image: local.image,
        };
      },
    }),
    ...(useGoogle
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
    // SSO bridge from the auctions backend. The Android WebView passes the
    // user's backend JWT as `?token=…` on first load; `TokenBridge.tsx`
    // posts it here and we mint a Bet session if the HMAC matches the
    // shared secret `BACKEND_JWT_SECRET`. Hidden from the login page —
    // there's no "sign in with backend token" button, only programmatic
    // sign-in from `signIn("backend-jwt", …)`.
    ...(isBackendBridgeEnabled()
      ? [
          CredentialsProvider({
            id: "backend-jwt",
            name: "Backend SSO",
            credentials: {
              token: { label: "Backend JWT", type: "text" },
            },
            async authorize(credentials) {
              if (!credentials?.token) return null;
              let payload;
              try {
                payload = await verifyBackendJwt(credentials.token);
              } catch {
                // Don't leak whether the token was expired vs forged.
                return null;
              }
              // Phone-only backend accounts can't be bridged today: Bet
              // requires a unique email. Surface this by rejecting the
              // sign-in; the Android client can fall back to the normal
              // Bet login.
              if (!payload.email) return null;

              const existing = await db.user.findUnique({
                where: { email: payload.email },
              });
              if (existing) {
                if (existing.banned) return null;
                return {
                  id: existing.id,
                  email: existing.email,
                  name: existing.username,
                  image: existing.image,
                  // Stash the backend identity so `jwt` callback can
                  // persist it on the NextAuth token — server-side
                  // calls into the auctions backend mint a fresh
                  // backend JWT using these fields.
                  backendUserId: payload.sub,
                  backendUsername: payload.username,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any;
              }

              // First time this backend user lands on Bet — provision a
              // matching Bet account. Mirrors the Google OAuth branch in
              // `signIn` below: claim a unique username, seed the wallet,
              // log the signup bonus.
              const baseUsername =
                payload.username
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "")
                  .slice(0, 20) || `user${Math.floor(Math.random() * 9999)}`;
              let username = baseUsername;
              let i = 0;
              while (await db.user.findUnique({ where: { username } })) {
                i += 1;
                username = `${baseUsername}${i}`;
              }
              const created = await db.user.create({
                data: {
                  email: payload.email,
                  username,
                  wallet: { create: { balance: signupCoins() } },
                  txns: {
                    create: {
                      delta: signupCoins(),
                      kind: "signup_bonus",
                      reference: `signup:${payload.email}`,
                    },
                  },
                },
              });
              return {
                id: created.id,
                email: created.email,
                name: created.username,
                image: created.image,
                backendUserId: payload.sub,
                backendUsername: payload.username,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // Google OAuth path: ensure a User row exists, with a wallet + signup
      // bonus. NextAuth's built-in Adapter would do similar, but we want a
      // username + walletbalance with a single Postgres round-trip on the
      // first sign-in.
      if (account?.provider === "google" && user.email) {
        const existing = await db.user.findUnique({ where: { email: user.email } });
        if (!existing) {
          const baseUsername = (profile?.name ?? user.email.split("@")[0])
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "")
            .slice(0, 20) || `user${Math.floor(Math.random() * 9999)}`;
          // Suffix duplicates so username uniqueness can't reject the sign-in.
          let username = baseUsername;
          let i = 0;
          while (await db.user.findUnique({ where: { username } })) {
            i += 1;
            username = `${baseUsername}${i}`;
          }
          await db.user.create({
            data: {
              email: user.email,
              username,
              image: user.image,
              wallet: { create: { balance: signupCoins() } },
              txns: { create: { delta: signupCoins(), kind: "signup_bonus", reference: `signup:${user.email}` } },
            },
          });
        } else if (existing.banned) {
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      // Persist db id + admin flag onto the JWT so server routes can authorise
      // off the cookie alone (no extra db round-trip on each request).
      if (user?.email) {
        const row = await db.user.findUnique({
          where: { email: user.email },
          select: { id: true, username: true, isAdmin: true, image: true },
        });
        if (row) {
          token.uid = row.id;
          token.username = row.username;
          token.isAdmin = row.isAdmin;
          token.picture = row.image ?? token.picture;
        }
      }
      // Carry the backend identity through, when present. This is only
      // set by the `backend-jwt` Credentials provider — Bet-native logins
      // (password / Google) leave these undefined, which means server
      // actions targeting the auctions backend will refuse to act on
      // their behalf. That refusal is intentional: a Bet-only account
      // has no auctions-backend identity to act AS.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = user as any;
      if (u?.backendUserId) {
        token.backendUserId = u.backendUserId;
        token.backendUsername = u.backendUsername;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).id = token.uid;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).username = token.username;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).isAdmin = !!token.isAdmin;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).backendUserId = token.backendUserId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).backendUsername = token.backendUsername;
        session.user.name = (token.username as string) ?? session.user.name;
      }
      return session;
    },
  },
};

/**
 * Helper for route handlers. Returns the authed userId, isAdmin, or null.
 *
 * `backendUserId` + `backendUsername` are populated only when the user
 * signed in via the SSO bridge from the auctions backend (Android
 * WebView path). Bet-native users get `null` for these — call sites that
 * need to talk to the auctions backend should treat that as "not bridged
 * yet" and instruct the user to enter via the Android app.
 */
export async function getAuthedUser() {
  const session = await getServerSession(authOptions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = session?.user as any;
  if (!u?.id) return null;

  // PR-BET-ADMIN-REDESIGN — fetch the live `adminRole` from the DB
  // on the same query that already exists in the session refresh
  // path. We don't mint `adminRole` into the JWT (yet) because
  // session JWTs are long-lived and demoting an admin shouldn't have
  // to wait for the next refresh. A single SELECT per authed
  // request is cheap; if it ever shows up in profiling we can cache
  // for a few seconds.
  // PR-BET-HOTFIX-SCHEMA-RESYNC — use a raw query instead of the
  // generated Prisma client so this code path NEVER 500s the page
  // even if the `adminRole` column is missing from the deployed
  // database (e.g. migration didn't fully apply yet). The previous
  // version used `db.user.findUnique({ select: { adminRole: true }})`
  // which throws a `PrismaClientKnownRequestError` when the column
  // doesn't exist — wrapping in try/catch swallows the error, but
  // OTHER call sites that read the User table without try/catch
  // (e.g. the landing page's leaderboard query) still crash on the
  // same missing column. The repair migration in this PR fixes the
  // root cause; this raw query is belt-and-braces so we don't depend
  // on the migration succeeding to keep the auth gate working.
  let adminRole: "SUPER_ADMIN" | "ADMIN" | null = null;
  try {
    const rows = await db.$queryRaw<Array<{ adminRole: string | null }>>`
      SELECT "adminRole" FROM "User" WHERE "id" = ${u.id as string} LIMIT 1
    `;
    const value = rows[0]?.adminRole;
    if (value === "SUPER_ADMIN" || value === "ADMIN") {
      adminRole = value;
    }
  } catch {
    /* Column missing / DB blip — fall through with adminRole=null.
       isAdmin then derives from the JWT's u.isAdmin flag (read-only
       fallback while ops fixes the schema). */
  }

  return {
    id: u.id as string,
    username: u.username as string,
    /// `isAdmin` is now derived from `adminRole != null` so promoting /
    /// demoting via the new Roles UI takes effect immediately without
    /// waiting for a JWT refresh. Old call sites that read `isAdmin`
    /// continue to work without code changes.
    isAdmin: adminRole != null || !!u.isAdmin,
    adminRole,
    email: session?.user?.email ?? null,
    backendUserId: (u.backendUserId ?? null) as string | null,
    backendUsername: (u.backendUsername ?? null) as string | null,
  };
}

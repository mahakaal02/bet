import { getAuthedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";

/**
 * RBAC primitives (PR-BET-ADMIN-REDESIGN).
 *
 * Two-tier model: SUPER_ADMIN (singleton) + ADMIN (variable). Every
 * admin route handler should call exactly one of:
 *
 *   requireAdmin()        — any tier; rejects regular users.
 *   requireSuperAdmin()   — only the super admin; rejects ADMIN tier.
 *
 * Both return the authed user when authorised, throw a typed
 * `RbacError` when not. Wrap calls in try/catch and convert to
 * NextResponse.json(...) at the route boundary.
 *
 * Why a typed error vs returning null: existing route handlers
 * already pattern-match on null to mean "not signed in" — keeping a
 * separate signal for "signed in but wrong tier" lets callers return
 * 403 (vs 401) without ambiguity.
 */

export class RbacError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RbacError";
  }
}

type AuthedAdmin = NonNullable<Awaited<ReturnType<typeof getAuthedUser>>>;

/**
 * Asserts the request is from any admin (SUPER_ADMIN or ADMIN).
 * Throws RbacError on unauth / wrong tier.
 */
export async function requireAdmin(): Promise<AuthedAdmin> {
  const u = await getAuthedUser();
  if (!u) throw new RbacError(401, "unauthenticated", "Sign in required.");
  if (u.adminRole == null && !u.isAdmin) {
    throw new RbacError(403, "not_admin", "Admin access required.");
  }
  return u;
}

/**
 * Asserts the request is from the super admin specifically. Used by
 * the admin-management endpoints (creating / revoking other admins);
 * normal operator actions should use `requireAdmin()` instead so any
 * staff member can perform them.
 */
export async function requireSuperAdmin(): Promise<AuthedAdmin> {
  const u = await getAuthedUser();
  if (!u) throw new RbacError(401, "unauthenticated", "Sign in required.");
  if (u.adminRole !== "SUPER_ADMIN") {
    throw new RbacError(
      403,
      "not_super_admin",
      "This action requires super-admin privileges.",
    );
  }
  return u;
}

/**
 * Find the canonical super admin row, if any. Used by the seed (boot
 * promotion) and by the Roles UI to know who can't be revoked.
 *
 * The partial-unique index on `User.adminRole WHERE adminRole =
 * 'SUPER_ADMIN'` makes this query touch a single row. If for any
 * reason multiple SUPER_ADMIN rows exist (manual DB edit, race during
 * an in-flight migration), the oldest one wins — picking the most-
 * recently-promoted would let an attacker who briefly compromised
 * the role grant themselves permanent access by being newer.
 */
export async function findSuperAdmin() {
  return db.user.findFirst({
    where: { adminRole: "SUPER_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      username: true,
      adminRole: true,
      createdAt: true,
    },
  });
}

/**
 * Promote a user to SUPER_ADMIN.
 *
 * Idempotent: if the user is already the super admin, no-op. If a
 * DIFFERENT user is currently the super admin, throws — there can
 * only be one. The seed script uses this; the UI does not expose it
 * (promoting another super admin would let an admin override the
 * client's chosen ops lead).
 */
export async function promoteToSuperAdmin(userId: string) {
  const existing = await findSuperAdmin();
  if (existing && existing.id === userId) {
    return existing; // idempotent
  }
  if (existing && existing.id !== userId) {
    throw new RbacError(
      409,
      "super_admin_exists",
      `Super admin already exists (@${existing.username}). Demote them first.`,
    );
  }
  return db.user.update({
    where: { id: userId },
    data: { adminRole: "SUPER_ADMIN", isAdmin: true },
  });
}

/**
 * Promote / demote an admin. Super-admin-only.
 *
 *   - role: "ADMIN" → user becomes a staff admin.
 *   - role: null    → revoke admin (back to regular user).
 *
 * Refuses to demote / promote-over the super admin themselves — that
 * path is gated to direct DB access to prevent a compromised UI
 * session from locking the owner out.
 */
export async function setAdminRole(userId: string, role: "ADMIN" | null) {
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, adminRole: true, username: true },
  });
  if (!target) {
    throw new RbacError(404, "user_not_found", "User does not exist.");
  }
  if (target.adminRole === "SUPER_ADMIN") {
    throw new RbacError(
      403,
      "super_admin_immutable",
      "The super admin cannot be modified from this UI.",
    );
  }
  return db.user.update({
    where: { id: userId },
    data: {
      adminRole: role,
      isAdmin: role != null,
    },
  });
}

/**
 * Create a one-time invite token. Returns the row including the
 * raw token (caller is responsible for emailing it to the invitee).
 *
 * Default TTL is 7 days. Tokens are 32-byte URL-safe random
 * strings, stored verbatim (not hashed) because they're one-shot
 * and revocable — a stolen token is no worse than a stolen
 * password-reset link.
 */
export async function createAdminInvite(opts: {
  email: string;
  username: string;
  invitedById: string;
  role?: "ADMIN";
  ttlDays?: number;
}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (opts.ttlDays ?? 7) * 24 * 60 * 60 * 1000);
  return db.adminInvite.create({
    data: {
      email: opts.email.trim().toLowerCase(),
      username: opts.username.trim(),
      role: opts.role ?? "ADMIN",
      token,
      invitedById: opts.invitedById,
      expiresAt,
    },
  });
}

/**
 * Redeem an invite token. Promotes the matching user (by email) to
 * ADMIN and marks the invite consumed. Refuses expired / revoked /
 * already-redeemed invites.
 *
 * The matching user must already exist (regular signup happens
 * first); we don't auto-create users from the invite because the
 * password-set + email-verify flow needs to run on the normal path
 * for compliance.
 */
export async function redeemAdminInvite(token: string, accepterUserId: string) {
  const invite = await db.adminInvite.findUnique({ where: { token } });
  if (!invite) {
    throw new RbacError(404, "invite_not_found", "Invalid invite link.");
  }
  if (invite.revokedAt) {
    throw new RbacError(410, "invite_revoked", "This invite was revoked.");
  }
  if (invite.acceptedAt) {
    throw new RbacError(410, "invite_consumed", "This invite was already used.");
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new RbacError(410, "invite_expired", "This invite has expired.");
  }
  const user = await db.user.findUnique({ where: { id: accepterUserId } });
  if (!user) {
    throw new RbacError(404, "user_not_found", "Accepting user not found.");
  }
  if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    throw new RbacError(
      403,
      "invite_email_mismatch",
      "This invite was issued to a different email address.",
    );
  }
  // Two writes in a transaction: mark invite consumed, promote user.
  await db.$transaction([
    db.adminInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), acceptedById: accepterUserId },
    }),
    db.user.update({
      where: { id: accepterUserId },
      data: { adminRole: invite.role, isAdmin: true },
    }),
  ]);
  return invite;
}

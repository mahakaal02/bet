import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  fmtDate,
} from "@/components/admin/ui/primitives";
import { IconRoles, IconShield } from "@/components/admin/ui/icons";
import { RolesClient } from "./RolesClient";

export const dynamic = "force-dynamic";

/**
 * Roles & access (PR-BET-ADMIN-REDESIGN).
 *
 * Super-admin-only surface. Lists every admin, every pending invite,
 * and exposes create / revoke actions. Regular admins (ADMIN tier)
 * who navigate here get a polite "super admin only" empty state —
 * they can still see who the team is, just can't change it.
 *
 * The page is split server / client: the server side renders the
 * initial list (no client-side waterfall) + handles the
 * super-admin-only redirect; the client side wraps the actions
 * (form submit + revoke buttons) so they can update optimistically.
 */
export default async function RolesPage() {
  const me = await getAuthedUser();
  // Layout already gated isAdmin; here we additionally distinguish
  // super-admin to render the management UI vs the read-only view.
  if (!me) redirect("/login?next=/admin/roles");
  const isSuper = me.adminRole === "SUPER_ADMIN";

  const [admins, invites] = await Promise.all([
    db.user.findMany({
      where: { adminRole: { not: null } },
      orderBy: [{ adminRole: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        email: true,
        username: true,
        adminRole: true,
        createdAt: true,
        banned: true,
      },
    }),
    isSuper
      ? db.adminInvite.findMany({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  // Resolve inviter usernames in a single follow-up query — AdminInvite
  // doesn't declare a relation to User (would need a back-reference on
  // User that's of zero value to the data model). One pass is cheaper
  // and keeps the schema minimal.
  const inviterIds = Array.from(new Set(invites.map((i) => i.invitedById)));
  const inviters =
    inviterIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: inviterIds } },
          select: { id: true, username: true },
        })
      : [];
  const inviterById = new Map(inviters.map((u) => [u.id, u.username]));

  return (
    <>
      <PageHeader
        kicker="Users"
        title="Roles & access"
        description={
          isSuper
            ? "You're the super admin. Invite operators to share the workload — every invitee gets full operational access except admin management."
            : "Read-only view of the admin team. Only the super admin can invite or revoke."
        }
      />

      {/* Singleton super-admin badge — reminds operators that the
          owner-tier seat is owned and immutable from the UI. */}
      <Card className="mb-5 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-rose-500 text-slate-950">
            <IconShield size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[var(--admin-text-primary)]">
                Super admin
              </span>
              <Badge tone="warning" dot>
                Singleton
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--admin-text-secondary)]">
              One row only — set at deploy via{" "}
              <code className="rounded bg-[var(--admin-elevated)] px-1 py-0.5 text-[10px] font-mono">
                KALKI_SUPER_ADMIN_EMAIL
              </code>
              . Cannot be created / demoted from this UI. To rotate,
              update the env var and re-run the seed.
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-bold text-[var(--admin-text-primary)]">
              @{admins.find((a) => a.adminRole === "SUPER_ADMIN")?.username ?? "—"}
            </div>
            <div className="text-[10px] text-[var(--admin-text-muted)]">
              {admins.find((a) => a.adminRole === "SUPER_ADMIN")?.email ?? "—"}
            </div>
          </div>
        </div>
      </Card>

      <RolesClient
        isSuper={isSuper}
        admins={admins.map((a) => ({
          id: a.id,
          email: a.email,
          username: a.username,
          adminRole: a.adminRole,
          createdAt: a.createdAt.toISOString(),
          banned: a.banned,
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          username: i.username,
          token: isSuper ? i.token : "•••",
          expiresAt: i.expiresAt.toISOString(),
          createdAt: i.createdAt.toISOString(),
          invitedBy: inviterById.get(i.invitedById) ?? "—",
        }))}
      />

      {admins.length === 1 && (
        <Card className="mt-5">
          <EmptyState
            icon={<IconRoles size={18} />}
            title="You're solo right now"
            description={
              isSuper
                ? "Once volume picks up, invite operators here to share the load. Every invited admin gets full operational access (markets, withdrawals, fraud, KYC, settings) except admin management."
                : ""
            }
          />
        </Card>
      )}
    </>
  );
}

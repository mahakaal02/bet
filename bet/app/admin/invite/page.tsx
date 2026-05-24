import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/admin/ui/primitives";
import { IconRoles, IconCheck, IconAlert } from "@/components/admin/ui/icons";
import { RedeemClient } from "./RedeemClient";

export const dynamic = "force-dynamic";

/**
 * Admin invite redemption (PR-BET-ADMIN-REDESIGN).
 *
 * Public-readable but action-gated: the page renders for anyone with
 * the token URL, but actually accepting requires being signed in as
 * the matching email. If the visitor is anonymous, we bounce them to
 * /login with `?next=` set so they end up back here after sign-in.
 */
export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <>
        <PageHeader title="Invite missing" />
        <Card className="p-6">
          <p className="text-sm text-[var(--admin-text-secondary)]">
            This URL doesn't include a token. Ask the super admin to
            re-issue the invite from <code>/admin/roles</code>.
          </p>
        </Card>
      </>
    );
  }

  const invite = await db.adminInvite.findUnique({ where: { token } });
  if (!invite) {
    return (
      <>
        <PageHeader title="Invite not found" />
        <Card className="p-6">
          <p className="text-sm text-[var(--admin-text-secondary)]">
            The token is invalid. It may have been revoked or
            mistyped. Ask the super admin to re-issue.
          </p>
        </Card>
      </>
    );
  }

  if (invite.acceptedAt) {
    return (
      <>
        <PageHeader title="Invite already used" />
        <Card className="p-6">
          <p className="text-sm text-[var(--admin-text-secondary)]">
            This invite was already accepted on{" "}
            {invite.acceptedAt.toLocaleString("en-IN")}.
          </p>
        </Card>
      </>
    );
  }
  if (invite.revokedAt) {
    return (
      <>
        <PageHeader title="Invite revoked" />
        <Card className="p-6">
          <p className="text-sm text-[var(--admin-text-secondary)]">
            The super admin revoked this invite. Ask for a fresh one.
          </p>
        </Card>
      </>
    );
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return (
      <>
        <PageHeader title="Invite expired" />
        <Card className="p-6">
          <p className="text-sm text-[var(--admin-text-secondary)]">
            Invites expire after 7 days. Ask the super admin to
            re-issue.
          </p>
        </Card>
      </>
    );
  }

  const me = await getAuthedUser();
  if (!me) {
    redirect(`/login?next=/admin/invite?token=${encodeURIComponent(token)}`);
  }

  const emailMatches = me.email?.toLowerCase() === invite.email.toLowerCase();

  return (
    <>
      <PageHeader
        title="Admin invite"
        description="You've been invited to share operator access to the Kalki Exchange."
      />
      <Card className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-cyan-500/15 text-cyan-300">
            <IconRoles size={20} />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--admin-text-primary)]">
              Invited as @{invite.username}
            </div>
            <div className="text-xs text-[var(--admin-text-secondary)]">
              For email {invite.email}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
              Role: {invite.role}
            </div>
          </div>
        </div>

        {emailMatches ? (
          <>
            <p className="mb-4 text-sm text-[var(--admin-text-secondary)]">
              Accepting promotes your existing account ({me.email}) to
              Admin tier with full operational access (markets,
              withdrawals, KYC, fraud, settings) except admin
              management.
            </p>
            <RedeemClient token={token} />
          </>
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <IconAlert size={14} /> Wrong account
            </div>
            <p>
              This invite was issued to <strong>{invite.email}</strong>{" "}
              but you're signed in as <strong>{me.email}</strong>. Sign
              out and sign in with the right account to accept.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}

"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  SectionTitle,
  fmtDate,
  toast,
} from "@/components/admin/ui/primitives";
import { IconPlus, IconTrash } from "@/components/admin/ui/icons";

/**
 * Client side of /admin/roles (PR-BET-ADMIN-REDESIGN).
 *
 * Two tables side-by-side on desktop, stacked on tablet:
 *
 *   • Active admins — every User with `adminRole != null`. Super
 *     admin is rendered with a special "Singleton" badge and no
 *     revoke button. Regular admins show a revoke button that's
 *     enabled only for the super admin viewer.
 *
 *   • Pending invites — every AdminInvite that hasn't been
 *     accepted, revoked, or expired. Super admin can copy the link
 *     or revoke; regular admins see "•••" in place of the token.
 *
 * Invite form is a one-line modal: email + username, server picks
 * the role ('ADMIN' is the only option per the two-tier model).
 */

interface AdminRow {
  id: string;
  email: string;
  username: string;
  adminRole: "SUPER_ADMIN" | "ADMIN" | null;
  createdAt: string;
  banned: boolean;
}

interface InviteRow {
  id: string;
  email: string;
  username: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

export function RolesClient({
  isSuper,
  admins,
  invites,
}: {
  isSuper: boolean;
  admins: AdminRow[];
  invites: InviteRow[];
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const staffAdmins = admins.filter((a) => a.adminRole === "ADMIN");

  async function createInvite() {
    if (!email || !username) {
      toast.warning("Email and username are both required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      toast.success("Invite created. Share the link with the new admin.");
      // Copy the redemption link to clipboard.
      const link = `${window.location.origin}/admin/invite?token=${data.token}`;
      try {
        await navigator.clipboard.writeText(link);
        toast.info("Invite link copied to clipboard.");
      } catch {
        /* user can copy manually from the table */
      }
      setOpen(false);
      setEmail("");
      setUsername("");
      // Hard refresh so the server-rendered tables show the new row.
      window.location.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeAdmin(userId: string, username: string) {
    if (!confirm(`Revoke admin access for @${username}?`)) return;
    try {
      const res = await fetch(`/api/admin/admins/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success(`@${username} demoted to regular user.`);
      window.location.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!confirm("Revoke this pending invite?")) return;
    try {
      const res = await fetch(`/api/admin/invites/${inviteId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success("Invite revoked.");
      window.location.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function copyInviteLink(token: string) {
    const link = `${window.location.origin}/admin/invite?token=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied to clipboard.");
    } catch {
      toast.error("Couldn't copy — copy the URL from the address bar.");
    }
  }

  return (
    <>
      {/* Staff admins table. */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--admin-divider)] px-4 py-3">
          <SectionTitle hint={`${staffAdmins.length} staff`}>Operators</SectionTitle>
          {isSuper && (
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
              <IconPlus size={14} /> Invite admin
            </Button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
            <tr>
              <th className="px-4 py-2 text-left">Operator</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Joined</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-divider)]">
            {staffAdmins.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-xs text-[var(--admin-text-muted)]">
                  No staff admins yet.{isSuper ? " Invite your first operator." : ""}
                </td>
              </tr>
            )}
            {staffAdmins.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-[var(--admin-text-primary)]">
                    @{a.username}
                  </div>
                  <div className="text-[10px] text-[var(--admin-text-muted)]">{a.email}</div>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone="info" dot>
                    Admin
                  </Badge>
                  {a.banned && (
                    <span className="ml-1">
                      <Badge tone="danger">Banned</Badge>
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--admin-text-secondary)]">
                  {fmtDate(a.createdAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {isSuper ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeAdmin(a.id, a.username)}
                    >
                      <IconTrash size={12} /> Revoke
                    </Button>
                  ) : (
                    <span className="text-[10px] text-[var(--admin-text-muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Pending invites — only render when there are any. */}
      {invites.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <div className="border-b border-[var(--admin-divider)] px-4 py-3">
            <SectionTitle hint={`${invites.length} pending`}>Pending invites</SectionTitle>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-[var(--admin-text-muted)]">
              <tr>
                <th className="px-4 py-2 text-left">Invitee</th>
                <th className="px-4 py-2 text-left">Issued</th>
                <th className="px-4 py-2 text-left">Expires</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-divider)]">
              {invites.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-[var(--admin-text-primary)]">
                      @{i.username}
                    </div>
                    <div className="text-[10px] text-[var(--admin-text-muted)]">{i.email}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--admin-text-secondary)]">
                    {fmtDate(i.createdAt)} · by @{i.invitedBy}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--admin-text-secondary)]">
                    {fmtDate(i.expiresAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {isSuper ? (
                      <div className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyInviteLink(i.token)}
                        >
                          Copy link
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revokeInvite(i.id)}
                        >
                          <IconTrash size={12} /> Revoke
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-[var(--admin-text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Invite-admin modal. */}
      <Modal open={open} onClose={() => setOpen(false)} title="Invite admin">
        <div className="space-y-3">
          <p className="text-xs text-[var(--admin-text-secondary)]">
            The invitee will receive a single-use link valid for 7 days.
            They'll need to register on the exchange with the same email
            first; redeeming the link promotes their account to Admin
            (full operational access except admin management).
          </p>
          <Input
            label="Email"
            type="email"
            placeholder="operator@kalki.local"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Username"
            placeholder="operator_ops"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createInvite} loading={busy}>
              Create invite
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

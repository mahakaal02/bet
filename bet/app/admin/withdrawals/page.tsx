import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { WithdrawalActions } from "@/components/WithdrawalActions";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, timeAgo } from "@/lib/utils";
import { hubLoginUrl } from "@/lib/hub";

export const dynamic = "force-dynamic";

/**
 * Admin withdrawal queue. Tabs by status (PENDING by default — the action
 * queue). Each row shows just enough payout detail to act + a one-click
 * link to the full user audit page where the admin can verify the user
 * earned their coins honestly.
 *
 * Payout details (UPI ID, account number, IFSC) are visible only to
 * admins here — they're required to actually send the money.
 */
export default async function AdminWithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const u = await getAuthedUser();
  if (!u) redirect(hubLoginUrl());
  if (!u.isAdmin) redirect("/");

  const sp = await searchParams;
  const allowed = ["PENDING", "APPROVED", "PAID", "REJECTED", "CANCELLED"] as const;
  const status = (allowed.find((s) => s === sp.status) ?? "PENDING") as
    | (typeof allowed)[number];

  const rows = await db.withdrawalRequest.findMany({
    where: { status },
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
    include: {
      user: {
        select: {
          username: true,
          email: true,
          emailVerified: true,
          banned: true,
          wallet: { select: { balance: true } },
        },
      },
      decidedBy: { select: { username: true } },
    },
  });

  const counts = await db.withdrawalRequest.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const total = (s: string) =>
    counts.find((c) => c.status === s)?._count.status ?? 0;

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-black">Withdrawals</h1>
          <Link
            href="/admin"
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Admin
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {allowed.map((s) => (
            <Link
              key={s}
              href={`/admin/withdrawals?status=${s}`}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                s === status
                  ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-200"
                  : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
              }`}
            >
              {s} <span className="text-slate-500">({total(s)})</span>
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-slate-500">
              Nothing in this queue.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map((w) => {
              const details = w.payoutDetails as Record<string, string>;
              return (
                <Card key={w.id}>
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <div>
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-xl font-black">
                          ₹{fmtCoins(w.amountCoins)}
                        </span>
                        <Badge
                          tone={
                            w.status === "PAID"
                              ? "yes"
                              : w.status === "REJECTED"
                                ? "no"
                                : w.status === "PENDING"
                                  ? "warn"
                                  : w.status === "APPROVED"
                                    ? "info"
                                    : "default"
                          }
                        >
                          {w.status}
                        </Badge>
                        <Badge>{w.payoutMethod}</Badge>
                        {w.user.banned && <Badge tone="no">User banned</Badge>}
                        {!w.user.emailVerified && (
                          <Badge tone="warn">Unverified email</Badge>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        <strong>{w.user.username}</strong> · {w.user.email}{" "}
                        · wallet now {fmtCoins(w.user.wallet?.balance ?? 0)}
                      </div>
                      <div className="mt-2 rounded-md border border-slate-800 bg-slate-950/40 p-2 font-mono text-[11px] text-slate-300">
                        {w.payoutMethod === "UPI" ? (
                          <>UPI: {details.upiId}</>
                        ) : (
                          <>
                            A/C {details.accountNumber} · IFSC {details.ifsc}
                            <br />
                            Beneficiary: {details.beneficiaryName}
                          </>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        Submitted {timeAgo(w.createdAt)}
                        {w.ipAddress && ` · ip ${w.ipAddress}`}
                        {w.decidedBy &&
                          ` · decided by ${w.decidedBy.username} ${
                            w.decidedAt ? timeAgo(w.decidedAt) : ""
                          }`}
                        {w.paidAt &&
                          ` · paid ${timeAgo(w.paidAt)} ref ${w.paidReference}`}
                      </div>
                      {w.decisionNote && (
                        <p className="mt-1 text-[11px] italic text-slate-400">
                          “{w.decisionNote}”
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 md:items-end">
                      <Link
                        href={`/admin/users/${w.userId}/audit`}
                        className="text-xs text-cyan-300 hover:text-cyan-200"
                      >
                        Audit this user →
                      </Link>
                      {(w.status === "PENDING" || w.status === "APPROVED") && (
                        <WithdrawalActions
                          id={w.id}
                          status={w.status}
                        />
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

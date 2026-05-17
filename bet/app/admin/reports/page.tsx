import { redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ReportRowActions } from "@/components/ReportRowActions";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Reports queue. Defaults to PENDING; admins can flip to RESOLVED /
 * DISMISSED via the tabs. For each pending report we also load a snippet
 * of the underlying content so the admin can decide without leaving the
 * page (one less round-trip per decision).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const u = await getAuthedUser();
  if (!u) redirect("/login?next=/admin/reports");
  if (!u.isAdmin) redirect("/");

  const sp = await searchParams;
  const status =
    sp.status === "RESOLVED" || sp.status === "DISMISSED" ? sp.status : "PENDING";

  const reports = await db.report.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      reporter: { select: { username: true } },
      resolver: { select: { username: true } },
    },
  });

  // Pull the underlying comment bodies for COMMENT-typed reports in one
  // query — avoids an N+1 over the list.
  const commentIds = reports
    .filter((r) => r.targetType === "COMMENT")
    .map((r) => r.targetId);
  const comments = commentIds.length
    ? await db.comment.findMany({
        where: { id: { in: commentIds } },
        include: {
          user: { select: { username: true } },
          market: { select: { slug: true, title: true } },
        },
      })
    : [];
  const commentById = new Map(comments.map((c) => [c.id, c]));

  const counts = await db.report.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const total = (s: string) =>
    counts.find((c) => c.status === s)?._count.status ?? 0;

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-black">Reports</h1>
          <Link
            href="/admin"
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Admin
          </Link>
        </div>

        <div className="mb-4 flex gap-2">
          {(["PENDING", "RESOLVED", "DISMISSED"] as const).map((s) => (
            <Link
              key={s}
              href={`/admin/reports?status=${s}`}
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

        {reports.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-sm text-slate-500">
              Nothing here.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => {
              const comment = commentById.get(r.targetId);
              const isPending = r.status === "PENDING";
              return (
                <Card key={r.id}>
                  <CardHeader>
                    <CardTitle>{r.targetType} report</CardTitle>
                    <Badge
                      tone={
                        r.status === "PENDING"
                          ? "warn"
                          : r.status === "RESOLVED"
                            ? "yes"
                            : "default"
                      }
                    >
                      {r.status}
                    </Badge>
                  </CardHeader>
                  <p className="text-sm text-slate-300">
                    <span className="font-semibold">{r.reporter.username}</span>{" "}
                    reported: <span className="text-slate-100">{r.reason}</span>
                  </p>
                  <div className="mt-1 text-[10px] text-slate-500">
                    {timeAgo(r.createdAt)}
                    {r.resolver && (
                      <>
                        {" · "}
                        decided by {r.resolver.username}
                        {r.resolvedAt && ` · ${timeAgo(r.resolvedAt)}`}
                      </>
                    )}
                    {r.resolverNote && (
                      <span className="italic"> · note: {r.resolverNote}</span>
                    )}
                  </div>

                  {comment && (
                    <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/40 p-2 text-sm">
                      <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
                        <span className="font-semibold text-slate-400">
                          {comment.user.username}
                        </span>
                        <span>·</span>
                        <Link
                          href={`/markets/${comment.market.slug}`}
                          className="hover:text-slate-200"
                        >
                          {comment.market.title}
                        </Link>
                        {comment.hidden && <Badge tone="no">Hidden</Badge>}
                      </div>
                      <p
                        className={
                          comment.hidden ? "italic text-slate-500" : "text-slate-200"
                        }
                      >
                        {comment.body}
                      </p>
                    </div>
                  )}

                  {!comment && r.targetType === "COMMENT" && (
                    <p className="mt-2 text-xs italic text-slate-500">
                      Target comment was deleted.
                    </p>
                  )}

                  {isPending && (
                    <div className="mt-3 border-t border-slate-800 pt-3">
                      <ReportRowActions
                        reportId={r.id}
                        targetType={r.targetType}
                        targetId={r.targetId}
                        canHide={!!comment && !comment.hidden}
                      />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

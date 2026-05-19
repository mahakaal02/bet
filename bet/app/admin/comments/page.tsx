import { redirect } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CommentModRow } from "@/components/CommentModRow";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Bulk comment moderation. Lists recent comments (and a "Hidden only" tab)
 * with one-click toggle. Backs onto PATCH /api/admin/comments/[id] and
 * audits each flip to AdminLog.
 */
export default async function AdminCommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const u = await getAuthedUser();
  if (!u) redirect("/login?next=/admin/comments");
  if (!u.isAdmin) redirect("/");

  const sp = await searchParams;
  const filter = sp.filter === "hidden" ? "hidden" : "all";
  const q = sp.q?.trim() ?? "";

  const comments = await db.comment.findMany({
    where: {
      ...(filter === "hidden" && { hidden: true }),
      ...(q && { body: { contains: q, mode: "insensitive" } }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { username: true } },
      market: { select: { slug: true, title: true } },
    },
  });

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-black">Comments</h1>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/reports"
              className="text-sm text-cyan-300 hover:text-cyan-200"
            >
              Reports →
            </Link>
            <Link
              href="/admin"
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              ← Admin
            </Link>
          </div>
        </div>

        <form method="get" className="mb-3 flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search bodies…"
            className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm"
          />
          {filter === "hidden" && (
            <input type="hidden" name="filter" value="hidden" />
          )}
          <button
            type="submit"
            className="h-9 rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm text-slate-200 hover:bg-slate-800"
          >
            Search
          </button>
        </form>

        <div className="mb-4 flex gap-2">
          {(["all", "hidden"] as const).map((f) => (
            <Link
              key={f}
              href={`/admin/comments${f === "hidden" ? "?filter=hidden" : ""}${q ? `${f === "hidden" ? "&" : "?"}q=${encodeURIComponent(q)}` : ""}`}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                f === filter
                  ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-200"
                  : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
              }`}
            >
              {f === "all" ? "All" : "Hidden only"}
            </Link>
          ))}
        </div>

        <Card>
          {comments.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No comments match.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {comments.map((c) => (
                <li key={c.id} className="py-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-300">
                        {c.user.username}
                      </span>
                      <span>·</span>
                      <Link
                        href={`/markets/${c.market.slug}`}
                        className="text-slate-400 hover:text-slate-200"
                      >
                        {c.market.title}
                      </Link>
                      <span>·</span>
                      <span>{timeAgo(c.createdAt)}</span>
                      {c.hidden && <Badge tone="no">Hidden</Badge>}
                    </div>
                  </div>
                  <p
                    className={`text-sm ${
                      c.hidden ? "italic text-slate-500" : "text-slate-200"
                    }`}
                  >
                    {c.body}
                  </p>
                  <div className="mt-2">
                    <CommentModRow id={c.id} hidden={c.hidden} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

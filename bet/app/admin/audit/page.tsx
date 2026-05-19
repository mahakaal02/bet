import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * Filterable + cursor-paginated AdminLog viewer. Previously the only
 * surface for these rows was the "Last 10 admin actions" sidecard on
 * the dashboard, which was fine for at-a-glance but useless for the
 * "who cancelled that order three days ago?" question.
 *
 * Filters:
 *   - `action`  matches a substring of the log's action name
 *               (e.g. `market` → market.create, market.resolve, …)
 *   - `admin`   matches the admin's username (case-insensitive)
 *   - `target`  matches a substring of the targetId (handy when you
 *               have a market id / order id from another page)
 *   - `before`  pagination cursor (the createdAt of the bottom row).
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actionParam = (sp.action ?? "").trim();
  const adminParam = (sp.admin ?? "").trim();
  const targetParam = (sp.target ?? "").trim();
  const before = typeof sp.before === "string" ? sp.before : null;

  // Cursor: the row with id=before tells us its createdAt; we then
  // query strictly older logs. Timestamp pagination is stable across
  // new writes — id-based pagination on cuid would skip rows that
  // race in just after the cursor was captured.
  let beforeCreatedAt: Date | undefined;
  if (before) {
    const ref = await db.adminLog.findUnique({
      where: { id: before },
      select: { createdAt: true },
    });
    if (ref) beforeCreatedAt = ref.createdAt;
  }

  // Resolve the admin filter to an id-set up front. Doing this in
  // memory keeps the AdminLog query single-table.
  let adminIds: string[] | null = null;
  if (adminParam) {
    const matches = await db.user.findMany({
      where: { username: { contains: adminParam, mode: "insensitive" } },
      select: { id: true },
      take: 50,
    });
    adminIds = matches.map((u) => u.id);
    if (adminIds.length === 0) {
      // Definitive empty result — short-circuit.
      return (
        <AuditShell
          actionParam={actionParam}
          adminParam={adminParam}
          targetParam={targetParam}
        >
          <p className="px-3 py-6 text-center text-slate-500">
            No admin matches “{adminParam}”.
          </p>
        </AuditShell>
      );
    }
  }

  const rows = await db.adminLog.findMany({
    where: {
      ...(actionParam && {
        action: { contains: actionParam, mode: "insensitive" },
      }),
      ...(adminIds && { adminId: { in: adminIds } }),
      ...(targetParam && {
        targetId: { contains: targetParam },
      }),
      ...(beforeCreatedAt && { createdAt: { lt: beforeCreatedAt } }),
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    include: { admin: { select: { username: true } } },
  });

  const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1].id : null;

  return (
    <AuditShell
      actionParam={actionParam}
      adminParam={adminParam}
      targetParam={targetParam}
    >
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-bold">When</th>
            <th className="px-3 py-2 text-left font-bold">Admin</th>
            <th className="px-3 py-2 text-left font-bold">Action</th>
            <th className="px-3 py-2 text-left font-bold">Target</th>
            <th className="px-3 py-2 text-left font-bold">Metadata</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                No log rows match these filters.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800/60 align-top">
                <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
                  <div>{timeAgo(r.createdAt)}</div>
                  <div className="text-[10px] text-slate-600">
                    {r.createdAt.toLocaleString()}
                  </div>
                </td>
                <td className="px-3 py-2 text-cyan-300">@{r.admin.username}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                  {r.targetId ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {r.metadata ? (
                    <pre className="max-w-md whitespace-pre-wrap break-words text-[11px] text-slate-500">
                      {JSON.stringify(r.metadata, null, 0)}
                    </pre>
                  ) : (
                    <span className="text-slate-700">—</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {nextCursor && (
        <div className="flex justify-end px-3 py-2">
          <Link
            href={buildCursorHref({
              actionParam,
              adminParam,
              targetParam,
              before: nextCursor,
            })}
            className="text-xs font-semibold text-cyan-300 hover:underline"
          >
            Older →
          </Link>
        </div>
      )}
    </AuditShell>
  );
}

function buildCursorHref(opts: {
  actionParam: string;
  adminParam: string;
  targetParam: string;
  before: string;
}) {
  const q = new URLSearchParams();
  if (opts.actionParam) q.set("action", opts.actionParam);
  if (opts.adminParam) q.set("admin", opts.adminParam);
  if (opts.targetParam) q.set("target", opts.targetParam);
  q.set("before", opts.before);
  return `/admin/audit?${q.toString()}`;
}

function AuditShell({
  actionParam,
  adminParam,
  targetParam,
  children,
}: {
  actionParam: string;
  adminParam: string;
  targetParam: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-black">Activity log</h1>
        <p className="text-xs text-slate-500">
          Every admin-initiated action — market lifecycle, force-cancels,
          withdrawal decisions, comment moderation, user bans. Filters are
          ANDed together.
        </p>
      </div>

      <form
        method="get"
        action="/admin/audit"
        className="flex flex-wrap items-end gap-3"
      >
        <FilterInput
          name="action"
          label="Action"
          placeholder="market.resolve"
          defaultValue={actionParam}
        />
        <FilterInput
          name="admin"
          label="Admin (username)"
          placeholder="@you"
          defaultValue={adminParam}
        />
        <FilterInput
          name="target"
          label="Target ID prefix"
          placeholder="cm…"
          defaultValue={targetParam}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Apply
          </button>
          {(actionParam || adminParam || targetParam) && (
            <Link
              href="/admin/audit"
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-900"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      <Card className="overflow-x-auto p-0">{children}</Card>
    </div>
  );
}

function FilterInput({
  name,
  label,
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {label}
      </span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-48 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 focus:border-cyan-500/60 focus:outline-none"
      />
    </label>
  );
}

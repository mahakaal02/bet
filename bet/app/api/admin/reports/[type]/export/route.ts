import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, RbacError } from "@/lib/rbac";

/**
 * GET /api/admin/reports/[type]/export (PR-BET-ADMIN-REDESIGN).
 *
 * Streams a CSV file for the requested report template. The five
 * templates are declared inline below — each is a Prisma query plus
 * a tiny CSV serializer. Sync streaming (one response, full payload)
 * is fine for our scale; if a report ever exceeds ~10 MB we'd switch
 * to a background-job pattern with S3 upload + signed URL.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ type: string }> },
) {
  try {
    await requireAdmin();
    const { type } = await context.params;
    const result = await buildReport(type);
    if (!result) {
      return NextResponse.json({ error: "unknown report type" }, { status: 404 });
    }
    return new NextResponse(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

async function buildReport(type: string): Promise<{ csv: string; filename: string } | null> {
  const date = new Date().toISOString().slice(0, 10);
  switch (type) {
    case "revenue": {
      const rows = await db.transaction.findMany({
        where: { kind: { in: ["commission", "resolution_fee"] } },
        orderBy: { createdAt: "desc" },
        take: 10000,
      });
      const csv = toCsv(
        ["date", "kind", "delta", "userId", "reference"],
        rows.map((r) => [
          r.createdAt.toISOString(),
          r.kind,
          r.delta.toString(),
          r.userId,
          r.reference ?? "",
        ]),
      );
      return { csv, filename: `kalki-revenue-${date}.csv` };
    }
    case "markets": {
      const rows = await db.market.findMany({
        include: { _count: { select: { trades: true, positions: true } } },
      });
      const csv = toCsv(
        ["id", "slug", "title", "category", "status", "resolvedAs", "volumeCoins", "trades", "positions", "endsAt"],
        rows.map((m) => [
          m.id,
          m.slug,
          m.title,
          m.category,
          m.status,
          m.resolvedAs ?? "",
          m.volumeCoins.toString(),
          m._count.trades.toString(),
          m._count.positions.toString(),
          m.endsAt.toISOString(),
        ]),
      );
      return { csv, filename: `kalki-markets-${date}.csv` };
    }
    case "users-pnl": {
      const positions = await db.position.findMany({
        include: { user: { select: { username: true, email: true } } },
      });
      const csv = toCsv(
        ["userId", "username", "email", "marketId", "outcome", "shares", "costBasis", "realizedPnl"],
        positions.map((p) => [
          p.userId,
          p.user.username,
          p.user.email,
          p.marketId,
          p.outcome,
          p.shares.toString(),
          p.costBasis.toString(),
          p.realizedPnl.toString(),
        ]),
      );
      return { csv, filename: `kalki-users-pnl-${date}.csv` };
    }
    case "withdrawals": {
      const rows = await db.withdrawalRequest.findMany({
        where: { status: "APPROVED" },
        include: { user: { select: { username: true, email: true } } },
        orderBy: { decidedAt: "desc" },
      });
      const csv = toCsv(
        ["id", "userId", "username", "email", "amountCoins", "method", "paidReference", "decidedAt"],
        rows.map((w) => [
          w.id,
          w.userId,
          w.user.username,
          w.user.email,
          w.amountCoins.toString(),
          w.payoutMethod,
          w.paidReference ?? "",
          w.decidedAt?.toISOString() ?? "",
        ]),
      );
      return { csv, filename: `kalki-withdrawals-${date}.csv` };
    }
    case "audit": {
      const rows = await db.adminLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 50000,
        include: { admin: { select: { username: true } } },
      });
      const csv = toCsv(
        ["at", "admin", "action", "targetId"],
        rows.map((l) => [
          l.createdAt.toISOString(),
          l.admin?.username ?? "—",
          l.action,
          l.targetId ?? "",
        ]),
      );
      return { csv, filename: `kalki-audit-${date}.csv` };
    }
    default:
      return null;
  }
}

/** Naive CSV serializer — quotes every cell + escapes inner quotes. */
function toCsv(headers: string[], rows: string[][]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = headers.map(esc).join(",");
  const body = rows.map((r) => r.map(esc).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

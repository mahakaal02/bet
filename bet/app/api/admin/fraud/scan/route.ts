import { NextResponse } from "next/server";
import { runFraudScan } from "@/lib/fraud-scanner";
import { requireAdmin, RbacError } from "@/lib/rbac";
import { db } from "@/lib/db";

/**
 * POST /api/admin/fraud/scan (PR-BET-ADMIN-FOLLOWUPS).
 *
 * Admin-triggered fraud scan. Runs the heuristic detectors over
 * the last 30 minutes of trades and returns the count + summary
 * of any signals inserted. Idempotent — re-running within 24h
 * produces zero new signals for the same scan keys.
 *
 * A cron worker invokes this same path every 5 minutes in production
 * (see PR-WORKER-EXTRACT for the worker pod). Admins can hit it
 * manually from the /admin/fraud page when they suspect activity
 * just happened.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const me = await requireAdmin();
    const result = await runFraudScan();
    await db.adminLog.create({
      data: {
        adminId: me.id,
        action: "fraud.scan.manual",
        metadata: {
          scanned: result.scanned,
          inserted: result.inserted,
        },
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RbacError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

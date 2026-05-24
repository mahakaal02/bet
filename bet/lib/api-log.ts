import { db } from "@/lib/db";

/**
 * API request logger (PR-BET-ADMIN-FOLLOWUPS).
 *
 * Writes one row to the `ApiLog` table after a route handler resolves.
 * Designed to be cheap-fail: if the DB write throws, the original
 * response still returns to the user — we never block a real request
 * on the log.
 *
 * Usage from a Node-runtime route handler:
 *
 *   export async function POST(req: Request) {
 *     const t0 = Date.now();
 *     let status = 200;
 *     try {
 *       // ...handler body...
 *       return NextResponse.json({ ok: true });
 *     } catch (e) {
 *       status = 500;
 *       throw e;
 *     } finally {
 *       logApiCall({
 *         method: 'POST', path: '/api/admin/markets/[id]/resolve',
 *         status, durationMs: Date.now() - t0,
 *         userId: u?.id, ip: getIp(req), userAgent: req.headers.get('user-agent') ?? null,
 *       });
 *     }
 *   }
 *
 * Why not middleware: Next.js middleware runs in the Edge runtime,
 * which can't talk to Prisma. The trade-off is that each route opts
 * in explicitly — fine for the admin surface where every endpoint
 * matters; not necessary for high-volume read endpoints.
 *
 * 30-day retention shipped as a separate scheduled cleanup. Until
 * then, the table grows roughly N admin actions/day × 365 — for the
 * current admin volume (single super admin) this is < 10k rows/yr,
 * well within Postgres's comfort zone.
 */

export interface ApiLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  errorCode?: string | null;
}

/**
 * Fire-and-forget log write. Never throws; never blocks the response.
 * Returns a Promise that resolves to true on success / false on failure
 * — the caller can `void` the result if they don't care to await.
 */
export async function logApiCall(entry: ApiLogEntry): Promise<boolean> {
  try {
    await db.apiLog.create({ data: entry });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[api-log] failed to record request", e);
    return false;
  }
}

/**
 * Best-effort client IP extraction. Honours common reverse-proxy
 * headers in order of trust (CF-Connecting-IP > X-Real-IP >
 * X-Forwarded-For). Falls back to null when no header is present —
 * NextRequest doesn't expose the underlying socket so direct-connect
 * deployments (`npm run dev`) just get null.
 */
export function getIp(req: Request): string | null {
  const headers = req.headers;
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf;
  const real = headers.get("x-real-ip");
  if (real) return real;
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return null;
}

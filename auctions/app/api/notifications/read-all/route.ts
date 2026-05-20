import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";

/**
 * POST /api/notifications/read-all
 *
 * Thin proxy: marks every unread in-app notification as read.
 * Forwards the user's session JWT to the backend's
 * `POST /notifications/read-all` so the client never sees the
 * token (it lives in the HTTP-only cookie).
 */
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await backend.authed(token).post<{ marked: number }>(
      "/notifications/read-all",
      {},
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof BackendUnauthorized) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "internal" },
      { status: 500 },
    );
  }
}

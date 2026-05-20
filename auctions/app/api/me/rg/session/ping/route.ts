import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * POST /api/me/rg/session/ping — heartbeat for the session-reminder
 * feature. The client should call this every ~60s while the user is
 * active on the site. Response includes `reminderDue: true` when the
 * threshold has been crossed, so the UI can render a toast.
 *
 * Server-side this also enqueues the INAPP notification so users on
 * the Socket.IO room receive the reminder even with the tab in the
 * background.
 */
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const data = await backend.authed(token).post<unknown>("/me/rg/session/ping", {});
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Session expired." }, { status: 401 });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status ?? 500 });
    }
    return NextResponse.json({ message: "Ping failed." }, { status: 500 });
  }
}

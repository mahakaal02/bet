import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * POST /api/me/2fa/enroll
 *
 * Returns `{ otpauthUri, manualKey, backupCodes }`. The plaintext
 * backup codes are shown to the user ONCE and never recoverable —
 * the page surfaces them inside a downloadable / copyable block
 * and warns the user before they leave the page.
 */
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const data = await backend.authed(token).post<unknown>("/me/2fa/enroll", {});
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Couldn't start 2FA enrollment." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

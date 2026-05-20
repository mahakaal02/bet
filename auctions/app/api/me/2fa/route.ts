import { NextResponse } from "next/server";
import {
  backend,
  BackendApiError,
  BackendUnauthorized,
} from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * GET /api/me/2fa
 * Forwards to the backend's `/me/2fa/status`. Drives the "is 2FA on?"
 * banner on the settings page.
 */
export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const data = await backend.authed(token).get<unknown>("/me/2fa/status");
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Couldn't load 2FA status." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

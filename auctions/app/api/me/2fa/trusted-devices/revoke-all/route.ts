import { NextResponse } from "next/server";
import {
  backend,
  BackendApiError,
  BackendUnauthorized,
} from "@/lib/backend";
import {
  clearTrustedDeviceToken,
  getSessionToken,
} from "@/lib/session";

/**
 * Bulk revoke. Wipes the local cookie too — "revoke all" includes the
 * current browser by definition.
 */
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const data = await backend
      .authed(token)
      .post<unknown>("/me/2fa/trusted-devices/revoke-all", {});
    await clearTrustedDeviceToken();
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Couldn't revoke devices." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

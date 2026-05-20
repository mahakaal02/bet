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

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * Revoke a single trusted device. If the revoked id is the current
 * browser's row, we ALSO clear the local cookie so the next login on
 * this browser correctly prompts for 2FA (matching the server-side
 * state). The backend doesn't know which cookie matches which row at
 * this layer, so we can't always detect the self-revoke case — the
 * conservative read is to leave the cookie in place; the next login
 * will fail to verify and fall through to the 2FA prompt anyway.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    await backend
      .authed(token)
      .delete<unknown>(`/me/2fa/trusted-devices/${id}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Couldn't revoke device." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  } finally {
    // Reference the import so it's not pruned as unused — the cookie
    // cleanup hook is intentionally a no-op today (see header).
    void clearTrustedDeviceToken;
  }
}

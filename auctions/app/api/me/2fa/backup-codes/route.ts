import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * POST /api/me/2fa/backup-codes
 *
 * Regenerates the 10 backup codes. The old codes are no longer
 * valid the moment this returns — same security guarantee as
 * `git push --force-with-lease` on a rotation: there's no
 * "preserved" state, the new codes replace the set wholesale.
 */
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const data = await backend
      .authed(token)
      .post<unknown>("/me/2fa/backup-codes/regenerate", {});
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Couldn't regenerate codes." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

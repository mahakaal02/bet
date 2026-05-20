import { NextResponse } from "next/server";
import { z } from "zod";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

const Body = z.object({
  password: z.string().min(1).max(128),
  code: z.string().min(1).max(32),
});

/**
 * POST /api/me/2fa/disable
 *
 * Requires current password + a working second factor. Backend
 * collapses both failures into the same error message so the
 * attacker can't differentiate "wrong password" from "wrong code".
 */
export async function POST(req: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Password and code are required." },
      { status: 400 },
    );
  }
  try {
    await backend.authed(token).post<unknown>("/me/2fa/disable", parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Couldn't disable 2FA." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

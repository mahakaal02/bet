import { NextResponse } from "next/server";
import { z } from "zod";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

const Body = z.object({
  code: z.string().min(1).max(32),
});

/**
 * POST /api/me/2fa/verify
 *
 * Verifies the first TOTP code and flips 2FA on. After success the
 * page reloads to reflect the new status banner.
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
      { message: "Code is required." },
      { status: 400 },
    );
  }
  try {
    await backend.authed(token).post<unknown>("/me/2fa/verify", parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Invalid code." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * POST /api/me/rg/pending/cancel — drops any pending limit raise.
 * Thin proxy; the heavy lifting is in ResponsibleGamblingService.
 */
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const data = await backend.authed(token).post<unknown>("/me/rg/pending/cancel", {});
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Session expired." }, { status: 401 });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json({ message: err.message }, { status: err.status ?? 500 });
    }
    return NextResponse.json({ message: "Cancel failed." }, { status: 500 });
  }
}

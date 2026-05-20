import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * GET /api/me/kyc — proxy for the KYC status endpoint.
 * Mirrors the shape of /api/me/profile so the KYC client can reuse
 * the same auth + error envelope on the browser side.
 */
export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const data = await backend.authed(token).get<unknown>("/me/kyc");
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Session expired." }, { status: 401 });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message },
        { status: err.status ?? 500 },
      );
    }
    return NextResponse.json({ message: "Failed to load." }, { status: 500 });
  }
}

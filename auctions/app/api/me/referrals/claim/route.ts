import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

export async function POST(req: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { code?: unknown }).code !== "string") {
    return NextResponse.json({ message: "Invalid body." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await backend.authed(token).post<unknown>("/me/referrals/claim", body),
    );
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Session expired." }, { status: 401 });
    }
    if (err instanceof BackendApiError) {
      // The backend's structured error shape is { code, message }; the
      // client decodes `code` against a friendly-message map.
      return NextResponse.json(
        { message: err.message, code: err.code },
        { status: err.status ?? 500 },
      );
    }
    return NextResponse.json({ message: "Claim failed." }, { status: 500 });
  }
}

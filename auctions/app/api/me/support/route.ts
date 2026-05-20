import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

export async function GET() {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  try {
    return NextResponse.json(await backend.authed(token).get<unknown>("/me/support"));
  } catch (err) {
    if (err instanceof BackendUnauthorized) return NextResponse.json({ message: "Session expired." }, { status: 401 });
    if (err instanceof BackendApiError) {
      return NextResponse.json({ message: err.message, code: err.code }, { status: err.status ?? 500 });
    }
    return NextResponse.json({ message: "Failed to load." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Invalid body." }, { status: 400 });
  }
  try {
    return NextResponse.json(await backend.authed(token).post<unknown>("/me/support", body));
  } catch (err) {
    if (err instanceof BackendUnauthorized) return NextResponse.json({ message: "Session expired." }, { status: 401 });
    if (err instanceof BackendApiError) {
      // 409 — bubble up `existingTicketId` if present so the client
      // can redirect cleanly.
      return NextResponse.json(
        { message: err.message, code: err.code },
        { status: err.status ?? 500 },
      );
    }
    return NextResponse.json({ message: "Submit failed." }, { status: 500 });
  }
}

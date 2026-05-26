import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Invalid body." }, { status: 400 });
  }
  const { id } = await params;
  try {
    return NextResponse.json(
      await backend.authed(token).post<unknown>(`/me/support/${id}/reply`, body),
    );
  } catch (err) {
    if (err instanceof BackendUnauthorized) return NextResponse.json({ message: "Session expired." }, { status: 401 });
    if (err instanceof BackendApiError) return NextResponse.json({ message: err.message }, { status: err.status ?? 500 });
    return NextResponse.json({ message: "Reply failed." }, { status: 500 });
  }
}

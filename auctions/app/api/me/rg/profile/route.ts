import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * GET   /api/me/rg/profile  — current limits + cooldown/exclusion state
 * PATCH /api/me/rg/profile  — update one or more limits
 *
 * The backend service is the source of truth on the lower=instant /
 * raise=refused rule. We pass the body straight through; raise
 * attempts surface as 400 with a message the form can render.
 */

export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const data = await backend.authed(token).get<unknown>("/me/rg-profile");
    return NextResponse.json(data);
  } catch (err) {
    return surface(err);
  }
}

export async function PATCH(req: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Invalid body." }, { status: 400 });
  }
  try {
    const data = await backend.authed(token).patch<unknown>("/me/rg-profile", body);
    return NextResponse.json(data);
  } catch (err) {
    return surface(err);
  }
}

function surface(err: unknown): NextResponse {
  if (err instanceof BackendUnauthorized) {
    return NextResponse.json({ message: "Please sign in again." }, { status: 401 });
  }
  if (err instanceof BackendApiError) {
    return NextResponse.json(
      { message: err.message ?? "Request failed." },
      { status: err.status },
    );
  }
  return NextResponse.json(
    { message: "Couldn't reach the auctions service." },
    { status: 502 },
  );
}

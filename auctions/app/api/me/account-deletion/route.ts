import { NextResponse } from "next/server";
import {
  backend,
  BackendApiError,
  BackendUnauthorized,
} from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

export async function GET() {
  return withAuth((token) =>
    backend.authed(token).get<unknown>("/me/account-deletion"),
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withAuth((token) =>
    backend.authed(token).post<unknown>("/me/account-deletion", body ?? {}),
  );
}

async function withAuth<T>(
  handler: (token: string) => Promise<T>,
): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    return NextResponse.json(await handler(token));
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
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
}

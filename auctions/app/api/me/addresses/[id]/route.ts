import { NextResponse } from "next/server";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Invalid body." }, { status: 400 });
  }
  return withAuth((token) =>
    backend.authed(token).patch<unknown>(`/me/addresses/${id}`, body),
  );
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withAuth((token) =>
    backend.authed(token).delete<unknown>(`/me/addresses/${id}`),
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

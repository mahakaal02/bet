import { NextResponse } from "next/server";
import { z } from "zod";
import { backend, BackendApiError, BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

const Body = z.object({
  duration: z.enum(["day7", "day30", "day90", "permanent"]),
});

export async function POST(req: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Pick a duration: 7 days, 30 days, 90 days, or permanent." },
      { status: 400 },
    );
  }
  try {
    const data = await backend.authed(token).post<unknown>(
      "/me/rg/self-exclude",
      parsed.data,
    );
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Couldn't start self-exclusion." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

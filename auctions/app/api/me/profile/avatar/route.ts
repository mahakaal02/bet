import { NextResponse } from "next/server";
import {
  BackendApiError,
  BackendUnauthorized,
} from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * Avatar upload proxy. Forwards the multipart body straight through.
 * We don't use the typed `backend.authed().post(...)` helper because
 * it sets Content-Type: application/json — for multipart we need to
 * preserve the browser's auto-generated boundary header.
 */
export async function POST(req: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { message: "No file provided." },
      { status: 400 },
    );
  }

  try {
    const url = `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/me/profile/avatar`;
    const result = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
      cache: "no-store",
    });
    if (result.status === 401) {
      throw new BackendUnauthorized();
    }
    if (!result.ok) {
      let message = "Couldn't upload avatar.";
      try {
        const body = await result.json();
        message = Array.isArray(body?.message)
          ? body.message.join("; ")
          : body?.message ?? message;
      } catch {
        /* keep default */
      }
      return NextResponse.json({ message }, { status: result.status });
    }
    return NextResponse.json(await result.json());
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Please sign in again." }, {
        status: 401,
      });
    }
    if (err instanceof BackendApiError) {
      return NextResponse.json(
        { message: err.message ?? "Upload failed." },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

// Disable Next.js body parsing — formData() handles multipart streams.
export const runtime = "nodejs";

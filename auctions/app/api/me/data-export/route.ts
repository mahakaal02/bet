import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

/**
 * Streams the backend's JSON bundle through to the browser as an
 * attachment download. We don't json-parse it on the way through —
 * the body is potentially large and the Content-Disposition header
 * from the backend is what triggers the browser save dialog.
 */
export async function POST() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  try {
    const upstream = await fetch(
      `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/me/data-export`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (!upstream.ok) {
      const message = `data export failed (${upstream.status})`;
      return NextResponse.json({ message }, { status: upstream.status });
    }
    // Pass headers + body through. Content-Disposition is what makes
    // the browser save instead of render.
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
        "Content-Disposition":
          upstream.headers.get("content-disposition") ?? "attachment",
      },
    });
  } catch {
    return NextResponse.json(
      { message: "Couldn't reach the auctions service." },
      { status: 502 },
    );
  }
}

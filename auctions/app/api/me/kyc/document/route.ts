import { NextResponse } from "next/server";
import { BackendUnauthorized } from "@/lib/backend";
import { getSessionToken } from "@/lib/session";

/**
 * POST /api/me/kyc/document — multipart proxy. Same pattern as the
 * avatar upload (auctions/app/api/me/profile/avatar/route.ts): we
 * forward the FormData directly so the browser-generated boundary
 * survives, rather than letting the typed `backend.authed()` helper
 * set Content-Type: application/json.
 */
export async function POST(req: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ message: "No file provided." }, { status: 400 });
  }

  try {
    const url = `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/me/kyc/document`;
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
      let message = "Couldn't upload document.";
      let code: string | undefined;
      try {
        const body = await result.json();
        // The backend returns { code, ... } for known failures
        // (KYC_INFECTED_DOCUMENT, KYC_DOCUMENT_TOO_LARGE, etc).
        code = body?.code;
        message = Array.isArray(body?.message)
          ? body.message.join("; ")
          : body?.message ?? code ?? message;
      } catch {
        /* keep default */
      }
      return NextResponse.json({ message, code }, { status: result.status });
    }
    const data = await result.json().catch(() => ({}));
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      return NextResponse.json({ message: "Session expired." }, { status: 401 });
    }
    return NextResponse.json({ message: "Upload failed." }, { status: 500 });
  }
}

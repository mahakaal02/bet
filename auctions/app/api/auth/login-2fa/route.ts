import { NextResponse } from "next/server";
import { z } from "zod";
import { type LoginResponse } from "@/lib/backend";
import {
  setSessionToken,
  setTrustedDeviceToken,
} from "@/lib/session";

/**
 * POST /api/auth/login-2fa
 *
 * Step 2 of the 2FA login. Forwards `{ challengeToken, code, trustDevice }`
 * to the backend's `/auth/login/2fa` endpoint. On success the response
 * mirrors the normal login (`{ token, user }`). If `trustDevice` was
 * true AND the backend issued a trusted-device cookie value, we set
 * the long-lived `kalki_trusted_device` cookie so this browser skips
 * the 2FA prompt for the next 90 days.
 */

const Body = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(1).max(32),
  trustDevice: z.boolean().optional(),
});

interface BackendResponse extends LoginResponse {
  trustedDevice?: {
    cookieValue: string;
    expiresAt: string;
  };
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Code is required." },
      { status: 400 },
    );
  }

  try {
    const result = await fetch(
      `${process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"}/auth/login/2fa`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Forward UA + accept-language so the backend can label the
          // trusted-device row ("Chrome on macOS"). These are read by
          // the user-facing /me/2fa/trusted-devices list.
          "User-Agent": req.headers.get("user-agent") ?? "Unknown",
          "Accept-Language": req.headers.get("accept-language") ?? "en",
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      },
    );
    if (!result.ok) {
      const text = await result.text();
      let message = "Invalid code. Try again.";
      try {
        const body = JSON.parse(text);
        message = Array.isArray(body?.message)
          ? body.message.join("; ")
          : body?.message ?? message;
      } catch {
        /* keep default */
      }
      return NextResponse.json(
        { ok: false, message },
        { status: result.status },
      );
    }
    const data = (await result.json()) as BackendResponse;
    await setSessionToken(data.token);

    // Trust-this-device follow-through: mint the long-lived cookie.
    // We compute the maxAge from the backend's expiresAt so client
    // and server agree on lifetime even if the constant drifts.
    if (data.trustedDevice?.cookieValue) {
      const ttlSec = Math.max(
        60,
        Math.floor(
          (new Date(data.trustedDevice.expiresAt).getTime() - Date.now()) /
            1000,
        ),
      );
      await setTrustedDeviceToken(data.trustedDevice.cookieValue, ttlSec);
    }

    return NextResponse.json({
      ok: true,
      username: data.user.username,
      isAdmin: data.user.isAdmin,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Couldn't reach the auctions service — please try signing in again.",
      },
      { status: 502 },
    );
  }
}

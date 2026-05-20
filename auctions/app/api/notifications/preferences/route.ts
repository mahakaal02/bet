import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/session";
import {
  backend,
  BackendUnauthorized,
  type NotificationPreferences,
} from "@/lib/backend";

/**
 * PATCH /api/notifications/preferences
 *
 * Forwards a partial-update to the backend with the session JWT
 * attached. Schema mirrors `NotificationPreferences` (all fields
 * optional, boolean values).
 *
 * The `responsibleGambling` field is accepted for forwards-
 * compatibility but the backend silently coerces it back to `true`
 * (regulatory).
 */
const Body = z.object({
  outbid: z.boolean().optional(),
  auctionEnding: z.boolean().optional(),
  orderUpdates: z.boolean().optional(),
  dailyStreak: z.boolean().optional(),
  marketingPush: z.boolean().optional(),
  marketingEmail: z.boolean().optional(),
  responsibleGambling: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const updated = await backend
      .authed(token)
      .patch<NotificationPreferences>("/notifications/preferences", parsed.data);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof BackendUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "internal" },
      { status: 500 },
    );
  }
}

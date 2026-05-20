"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * One-click "mark all read" for the notification list header.
 *
 * Posts to `/api/notifications/read-all` (the Next API route that
 * proxies to the backend with the session token), then refreshes
 * the server-rendered list. We use `router.refresh()` rather than
 * client-state mutation because the list is itself server-rendered
 * — letting the same render path produce the post-update view keeps
 * the unread badge count in sync without parallel state.
 */
export function NotificationsMarkAllReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [_, startTransition] = useTransition();

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      startTransition(() => router.refresh());
    } catch {
      // Soft failure — the next page refresh will show the truth.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={busy}
      className="text-xs"
    >
      {busy ? "Marking…" : "Mark all read"}
    </Button>
  );
}

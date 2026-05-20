"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Session-reminder heartbeat (PR-RG-2). Mount once at the auctions
 * shell (Navbar level). Pings `/api/me/rg/session/ping` on a 60s
 * interval while the document is visible. If the server replies with
 * `reminderDue: true` we surface a banner.
 *
 * Design choices:
 *
 *   - Only pings while the tab is visible. A user with 12 background
 *     tabs shouldn't hold a fake "session" across days.
 *   - Hides the banner after 60s — server already wrote the event,
 *     so leaving the toast up forever would be annoying.
 *   - Failures are silent (network blips shouldn't bother the user).
 *
 * The page-level server components don't need to know this is
 * mounted; it's purely a client hook with its own auth bearer.
 */
export function SessionHeartbeat() {
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(null);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const ping = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/me/rg/session/ping", { method: "POST", cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { reminderDue?: boolean; minutesElapsed?: number };
        if (!active) return;
        if (body.reminderDue) {
          setReminderMinutes(body.minutesElapsed ?? null);
          if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
          dismissTimer.current = window.setTimeout(() => {
            if (active) setReminderMinutes(null);
          }, 60_000);
        }
      } catch {
        /* silent — heartbeat failure is fine */
      }
    };

    // Initial ping + interval.
    void ping();
    const handle = window.setInterval(() => void ping(), 60_000);

    return () => {
      active = false;
      window.clearInterval(handle);
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    };
  }, []);

  if (reminderMinutes === null) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-3">
      <div
        role="status"
        className="pointer-events-auto max-w-md rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-100 shadow-lg backdrop-blur"
      >
        <strong className="block font-semibold">Quick check-in</strong>
        <span className="text-xs text-amber-200/80">
          You've been playing for {reminderMinutes} minutes. Take a break if you need one.
        </span>
        <button
          type="button"
          onClick={() => setReminderMinutes(null)}
          className="ml-3 text-[11px] font-medium text-amber-100 underline-offset-2 hover:underline"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

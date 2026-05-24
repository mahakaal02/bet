"use client";

import { useState } from "react";
import { Button, toast } from "@/components/admin/ui/primitives";
import { IconRefresh } from "@/components/admin/ui/icons";

/**
 * Manual fraud-scan trigger (PR-BET-ADMIN-FOLLOWUPS). Operators
 * tap this to run the heuristic scanner immediately rather than
 * wait for the 5-minute cron tick. Returns the new-signals count
 * as a toast; reloads the page so the table refreshes.
 */
export function FraudScanButton() {
  const [busy, setBusy] = useState(false);
  async function scan() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/fraud/scan", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as { scanned: number; inserted: number };
      toast.success(
        `Scanned ${data.scanned} trades · ${data.inserted} new signal${data.inserted === 1 ? "" : "s"}`,
      );
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="secondary" onClick={scan} loading={busy}>
      <IconRefresh size={14} /> Run scan now
    </Button>
  );
}

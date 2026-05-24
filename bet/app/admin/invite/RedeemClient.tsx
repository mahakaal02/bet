"use client";

import { useState } from "react";
import { Button, toast } from "@/components/admin/ui/primitives";
import { IconCheck } from "@/components/admin/ui/icons";

/**
 * Invite-redemption button (PR-BET-ADMIN-REDESIGN). Client component
 * so we can show busy state + redirect on success.
 */
export function RedeemClient({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);

  async function redeem() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      toast.success("Welcome aboard. Reloading…");
      // Hard reload so the session JWT gets refreshed with the new
      // role and the layout admin gate flips green.
      setTimeout(() => window.location.replace("/admin"), 600);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Button variant="success" onClick={redeem} loading={busy}>
      <IconCheck size={14} /> Accept invite
    </Button>
  );
}

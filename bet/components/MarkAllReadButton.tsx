"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function MarkAllReadButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function mark() {
    setBusy(true);
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setBusy(false);
    startTransition(() => router.refresh());
  }
  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={mark}>
      Mark all read
    </Button>
  );
}

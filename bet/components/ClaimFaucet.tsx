"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { Coins } from "lucide-react";

export function ClaimFaucet() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function claim() {
    setBusy(true);
    try {
      const res = await fetch("/api/rewards/claim", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(prettyError(body.error), "err");
        return;
      }
      toast(`+${body.bonus} coins! Streak: ${body.streak}🔥`, "ok");
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={claim} disabled={busy} size="sm">
      <Coins className="h-4 w-4" />
      {busy ? "Claiming…" : "Claim daily faucet"}
    </Button>
  );
}

function prettyError(code?: string): string {
  switch (code) {
    case "already_claimed":
      return "You've already claimed today. Come back tomorrow!";
    case "unauthorized":
      return "Please sign in.";
    default:
      return "Couldn't claim — try again.";
  }
}

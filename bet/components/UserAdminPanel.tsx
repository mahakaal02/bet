"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";

interface Props {
  userId: string;
  initial: { isAdmin: boolean; banned: boolean; balance: number };
}

export function UserAdminPanel({ userId, initial }: Props) {
  const router = useRouter();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? "Action failed.", "err");
        return;
      }
      toast("Saved.", "ok");
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  async function adjustBalance(e: React.FormEvent) {
    e.preventDefault();
    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) {
      toast("Enter a non-zero integer.", "err");
      return;
    }
    await send({ adjustBalance: d, reason: reason.trim() || "admin_grant" });
    setDelta("");
    setReason("");
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Adjust coin balance
        </h4>
        <p className="mb-2 text-xs text-slate-500">
          Current: {initial.balance.toLocaleString()}. Use a negative number to
          deduct.
        </p>
        <form onSubmit={adjustBalance} className="flex gap-2">
          <Input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. 1000 or -500"
            className="w-32"
          />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
          />
          <Button type="submit" disabled={busy} size="md">
            Apply
          </Button>
        </form>
      </div>
      <div className="border-t border-slate-800 pt-3">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Flags
        </h4>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={initial.banned ? "secondary" : "danger"}
            size="sm"
            disabled={busy}
            onClick={() => send({ banned: !initial.banned })}
          >
            {initial.banned ? "Unban user" : "Ban user"}
          </Button>
          <Button
            variant={initial.isAdmin ? "danger" : "secondary"}
            size="sm"
            disabled={busy}
            onClick={() => send({ isAdmin: !initial.isAdmin })}
          >
            {initial.isAdmin ? "Revoke admin" : "Grant admin"}
          </Button>
        </div>
      </div>
    </div>
  );
}

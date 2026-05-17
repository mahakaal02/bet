"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";

/** One-button toggle for comment.hidden on /admin/comments. */
export function CommentModRow({
  id,
  hidden,
}: {
  id: string;
  hidden: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: !hidden }),
      });
      if (!res.ok) {
        toast("Action failed.", "err");
        return;
      }
      toast(hidden ? "Comment unhidden." : "Comment hidden.", "ok");
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={hidden ? "secondary" : "danger"}
      onClick={toggle}
      disabled={busy}
    >
      {hidden ? "Unhide" : "Hide"}
    </Button>
  );
}

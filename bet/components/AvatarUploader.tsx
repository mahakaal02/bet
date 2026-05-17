"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";

interface Props {
  /** Current avatar URL — null/undefined for the gradient initial fallback. */
  image: string | null;
  name: string;
  size?: number;
}

/**
 * Profile-page avatar with hover overlay + file picker. Click the avatar
 * itself to swap; click ✕ (only shown when an avatar exists) to remove.
 *
 * The component is fully optimistic — it shows the picked file via
 * `URL.createObjectURL` while the upload is in flight, then routes through
 * `router.refresh()` once the server confirms so /api/me, the navbar and
 * any other consumers re-fetch. The blob URL is revoked on cleanup to
 * avoid the well-known memory leak.
 */
export function AvatarUploader({ image, name, size = 56 }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Local preview shown while the upload is in flight.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  // Bust the browser cache when the server URL hasn't changed but the file
  // has (server replaces the URL on every upload, but defensive).
  const [bust, setBust] = useState<number>(0);
  const [, startTransition] = useTransition();

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("Image too large — keep it under 2 MB.", "err");
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setOptimistic(localUrl);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/me/avatar", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        URL.revokeObjectURL(localUrl);
        setOptimistic(null);
        toast(prettyError(body.error), "err");
        return;
      }
      toast("Avatar updated.", "ok");
      setBust(Date.now());
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
      // Reset the input so picking the same file twice still triggers
      // onChange (browsers skip the event for identical paths otherwise).
      if (inputRef.current) inputRef.current.value = "";
      // Revoke after a short delay so the <img> swap to the real URL
      // doesn't briefly show a broken state.
      setTimeout(() => {
        URL.revokeObjectURL(localUrl);
        setOptimistic(null);
      }, 2_000);
    }
  }

  async function onRemove() {
    if (!image) return;
    if (!confirm("Remove your avatar?")) return;
    setBusy(true);
    const res = await fetch("/api/me/avatar", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast("Could not remove avatar.", "err");
      return;
    }
    toast("Avatar removed.", "ok");
    startTransition(() => router.refresh());
  }

  return (
    <div className="relative inline-block group">
      <Avatar
        src={optimistic ?? image ?? null}
        name={name}
        size={size}
        bust={bust || undefined}
      />

      {/* Hover overlay (touch devices: tap the avatar tile directly). */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={cn(
          "absolute inset-0 grid place-items-center rounded-full bg-black/0 text-transparent transition",
          "hover:bg-black/55 hover:text-white focus-visible:bg-black/55 focus-visible:text-white focus:outline-none",
          busy && "bg-black/55 text-white",
        )}
        aria-label="Change avatar"
      >
        <Camera className="h-5 w-5" />
      </button>

      {image && !busy && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-slate-800 hover:text-rose-300"
          aria-label="Remove avatar"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={onPick}
        className="hidden"
      />
    </div>
  );
}

function prettyError(code?: string): string {
  switch (code) {
    case "unsupported_type":
      return "Only PNG / JPEG / WebP / GIF are supported.";
    case "too_large":
      return "Image too large — keep it under 2 MB.";
    case "bad_image":
      return "That file doesn't look like a valid image.";
    case "rate_limited":
      return "You're changing avatar too fast. Wait a minute.";
    case "no_file":
      return "Pick a file first.";
    default:
      return "Upload failed.";
  }
}

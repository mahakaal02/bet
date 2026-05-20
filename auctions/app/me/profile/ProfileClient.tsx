"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import type { ProfileData } from "./page";

/**
 * Two stacked cards: avatar (upload + preview) and display name
 * (text input + save). Both are independent — saving one doesn't
 * touch the other. Errors render inline.
 *
 * Avatar upload uses the browser's multipart form data so the bytes
 * never round-trip through this component's state.
 */
export function ProfileClient({ initial }: { initial: ProfileData }) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData>(initial);

  // ─── Display name state ─────────────────────────────────────────
  const [draftName, setDraftName] = useState(initial.displayName ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameOk, setNameOk] = useState<string | null>(null);

  // ─── Avatar state ───────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const renameLocked =
    profile.renameAvailableAt != null &&
    new Date(profile.renameAvailableAt).getTime() > Date.now();

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameBusy(true);
    setNameError(null);
    setNameOk(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: draftName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNameError(body?.message ?? "Couldn't save display name.");
        return;
      }
      // Re-fetch full profile so the cooldown timestamp updates.
      const next = await fetch("/api/me/profile", { cache: "no-store" });
      if (next.ok) {
        const data = (await next.json()) as ProfileData;
        setProfile(data);
        setDraftName(data.displayName ?? "");
      }
      setNameOk("Display name saved.");
      router.refresh();
    } catch {
      setNameError("Network error.");
    } finally {
      setNameBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const res = await fetch("/api/me/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAvatarError(body?.message ?? "Couldn't upload avatar.");
        return;
      }
      const next = await fetch("/api/me/profile", { cache: "no-store" });
      if (next.ok) {
        const data = (await next.json()) as ProfileData;
        setProfile(data);
      }
      router.refresh();
    } catch {
      setAvatarError("Network error.");
    } finally {
      setAvatarBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Avatar
        </h2>
        <div className="flex items-start gap-4">
          {profile.avatarUrl ? (
            // The /uploads/* path is served by the backend static
            // route — `<img>` is fine here, no Next/Image perf hit
            // because the file already exists at exact display size.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt="Avatar"
              width={88}
              height={88}
              className="h-22 w-22 rounded-full border border-slate-700 object-cover"
            />
          ) : (
            <div className="grid h-22 w-22 place-items-center rounded-full border border-slate-700 bg-slate-900/60 text-2xl font-black text-slate-400">
              {(profile.displayName ?? profile.username).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <p className="text-xs text-slate-500">
              JPEG, PNG, or WebP. Up to 4MB. Square images crop best.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
            <div className="mt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarBusy}
              >
                {avatarBusy ? "Uploading…" : profile.avatarUrl ? "Replace avatar" : "Upload avatar"}
              </Button>
            </div>
            {avatarError && (
              <p className="mt-2 text-xs text-rose-300">{avatarError}</p>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Display name
        </h2>
        <form onSubmit={saveName} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">
              what to show next to your @{profile.username} handle
            </span>
            <Input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              minLength={3}
              maxLength={40}
              disabled={renameLocked}
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              3–40 characters. Letters (any script), digits, space,
              hyphen, dot, underscore.
            </span>
          </label>
          {nameError && <p className="text-xs text-rose-300">{nameError}</p>}
          {nameOk && <p className="text-xs text-emerald-300">{nameOk}</p>}
          {renameLocked && profile.renameAvailableAt && (
            <p className="rounded border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
              Display name was changed recently — next change available{" "}
              {new Date(profile.renameAvailableAt).toLocaleDateString(
                undefined,
                { year: "numeric", month: "short", day: "numeric" },
              )}
              . Display-name changes are limited to one per 30 days.
            </p>
          )}
          <Button
            type="submit"
            disabled={
              nameBusy ||
              renameLocked ||
              draftName.trim().length === 0 ||
              draftName.trim() === (profile.displayName ?? "")
            }
          >
            {nameBusy ? "Saving…" : "Save name"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

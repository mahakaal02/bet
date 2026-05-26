"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * New-password form. Two password fields (with a client-side "match"
 * check) feeding `/api/auth/password-reset/confirm`.
 *
 * After a successful reset:
 *   - All existing sessions are invalidated server-side (the JWT
 *     iat-vs-passwordChangedAt check). Even if this browser had a
 *     valid session, it's now stale — the user must sign in again.
 *   - We surface a success card and route to /login after a beat
 *     so the user has time to read.
 */
export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    !busy && password.length >= 8 && password === confirm;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body?.message ??
            "This reset link is invalid or expired. Please request a new one.",
        );
        return;
      }
      setDone(true);
      // Brief delay so the user sees the success card.
      setTimeout(() => router.replace("/login"), 1500);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-5 text-sm text-emerald-100">
        <p className="font-semibold">Password updated.</p>
        <p className="mt-1 text-emerald-100/80">
          Sending you to sign-in…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          new password
        </span>
        <Input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tooShort && (
          <span className="mt-1 block text-[11px] text-amber-300">
            At least 8 characters.
          </span>
        )}
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          confirm new password
        </span>
        <Input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && (
          <span className="mt-1 block text-[11px] text-rose-300">
            Passwords don&apos;t match.
          </span>
        )}
      </label>
      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
          <Link
            href="/auth/forgot"
            className="ml-1 underline hover:opacity-80"
          >
            Request a new link.
          </Link>
        </div>
      )}
      <Button type="submit" disabled={!canSubmit} className="w-full">
        {busy ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}

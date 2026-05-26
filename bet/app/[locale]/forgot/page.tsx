"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (res.ok) {
      setSent(true);
    } else {
      const body = await res.json().catch(() => ({}));
      toast(body.error === "rate_limited" ? "Too many requests — wait a bit." : "Couldn't send link.", "err");
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-md px-4 py-12">
        <Link href="/login" className="mb-6 inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Back to sign in
        </Link>
        <Badge tone="info" className="mb-3">Kalki Exchange</Badge>
        <h1 className="text-2xl font-black">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your email; we&apos;ll send a reset link if there&apos;s a matching
          account.
        </p>

        <Card className="mt-4">
          {sent ? (
            <p className="text-sm text-emerald-300">
              ✅ If <strong>{email}</strong> is registered, you&apos;ll receive a
              reset link shortly. The link expires in 1 hour.
              <span className="mt-2 block text-xs text-slate-500">
                Dev: check the Next.js server console for the link.
              </span>
            </p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}

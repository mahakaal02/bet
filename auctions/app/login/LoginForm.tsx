"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Seed accounts created by `backend/prisma/seed.ts` and
 * `bet/prisma/seed.ts`. All four share the password `password12345`.
 * Chip-to-fill helps QA flip between identities while testing
 * real-time bid updates — open one browser as user1, another as
 * user2, watch the "outbid" status flip live.
 */
const SHARED_PASSWORD = "password12345";
const DEMO_USERS = [
  { email: "user1@kalki.local", label: "user1" },
  { email: "user2@kalki.local", label: "user2" },
  { email: "user3@kalki.local", label: "user3" },
];
const ADMIN_USER = {
  email: "admin@kalki.local",
  password: SHARED_PASSWORD,
  label: "admin",
};

export function LoginForm({
  next,
  demoVisible,
}: {
  next: string;
  demoVisible: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Sign-in failed.");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error — is the backend up on :4000?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
          Email
        </span>
        <Input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user1@kalki.local"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
          Password
        </span>
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password12345"
        />
      </label>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <Button type="submit" disabled={busy || !email || !password} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      {demoVisible && (
        <div className="space-y-2 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Demo users · password{" "}
            <code className="rounded bg-slate-800 px-1 text-slate-300">{SHARED_PASSWORD}</code>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => {
                  setEmail(u.email);
                  setPassword(SHARED_PASSWORD);
                }}
                className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800/60"
              >
                {u.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setEmail(ADMIN_USER.email);
                setPassword(ADMIN_USER.password);
              }}
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/15"
            >
              {ADMIN_USER.label}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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

/**
 * Two-step login form:
 *
 *   1. `password` step — email + password. Default state.
 *   2. `2fa` step — only reached when /api/auth/login returns
 *      `{ needs2FA: true, challengeToken }`. Collects the 6-digit
 *      TOTP or an 8-char backup code and POSTs to
 *      /api/auth/login-2fa to complete the session.
 *
 * Step state is local — no router navigation between steps so the
 * back button on a partially-completed login doesn't strand the
 * user. The challenge token lives only in component state; it's a
 * short-lived JWT and never persisted.
 */
export function LoginForm({
  next,
  demoVisible,
}: {
  next: string;
  demoVisible: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "2fa">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focus the code input as soon as we switch into the 2FA step.
  const codeInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === "2fa") codeInputRef.current?.focus();
  }, [step]);

  async function onPasswordSubmit(e: React.FormEvent) {
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
      if (body?.needs2FA && body?.challengeToken) {
        setChallengeToken(body.challengeToken);
        setStep("2fa");
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

  async function on2FASubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken, code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Invalid code.");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function backToPassword() {
    setStep("password");
    setChallengeToken(null);
    setCode("");
    setError(null);
  }

  if (step === "2fa") {
    return (
      <form onSubmit={on2FASubmit} className="space-y-3">
        <p className="text-sm text-slate-300">
          Two-factor authentication is on for this account. Enter the
          6-digit code from your authenticator app, or an 8-character
          backup code.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            verification code
          </span>
          <Input
            ref={codeInputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={32}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="tracking-widest text-center"
          />
        </label>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <Button type="submit" disabled={busy || !code} className="w-full">
          {busy ? "Verifying…" : "Verify and sign in"}
        </Button>
        <button
          type="button"
          onClick={backToPassword}
          className="block w-full text-center text-[11px] text-slate-500 hover:text-slate-300"
        >
          ← Use a different account
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onPasswordSubmit} className="space-y-3">
      <label className="block">
        {/* Field labels deliberately literal, lowercase, no placeholder
            hint inside the input — the visible text above each input
            *is* the affordance now, so the input itself stays clean
            until the user types. */}
        <span className="mb-1 block text-xs font-medium text-slate-400">
          mobile/email
        </span>
        {/* `type="text"` (not "email") so the field will accept either
            a mobile number or an email without HTML5 rejecting non-email
            strings before submit. Server still decides what's actually
            accepted. */}
        <Input
          type="text"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          password
        </span>
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <Button type="submit" disabled={busy || !email || !password} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-[11px] text-slate-500">
        <Link
          href="/auth/forgot"
          className="text-slate-400 hover:text-slate-200"
        >
          Forgot password?
        </Link>
      </p>

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

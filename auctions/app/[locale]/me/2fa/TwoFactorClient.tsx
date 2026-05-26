"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

/**
 * Client-side 2FA workflow.
 *
 * State machine:
 *
 *   off                 — no enrollment row yet (or it's been disabled).
 *                          Shows "Enable 2FA" CTA. Tapping it triggers
 *                          `enroll`.
 *   enrolling           — POST /api/me/2fa/enroll succeeded. We're
 *                          showing the otpauth URI (rendered as a QR
 *                          via an external image API), the manual key
 *                          fallback, and the 10 backup codes ONCE.
 *                          The user copies them off, scans the QR
 *                          into their authenticator, then types the
 *                          first code to confirm.
 *   on                  — Backend reports verified=true. We show the
 *                          "2FA on" state with Disable + Regenerate-
 *                          codes affordances.
 *
 * QR rendering: rather than ship a QR encoder in the bundle we use
 * Google's chart API. The otpauth URI is opaque (the secret embedded
 * in it is base32 noise), and we're sending it to a Google endpoint
 * the user is already trusting for Authenticator itself — net zero
 * additional surface area, much smaller bundle. Swap to a local
 * encoder later if we ever drop the Google dep.
 */

type Status = {
  enrolled: boolean;
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
};

type Enrollment = {
  otpauthUri: string;
  manualKey: string;
  backupCodes: string[];
};

export function TwoFactorClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Disable form state.
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");

  // Regenerated codes preview.
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setError(null);
    try {
      const res = await fetch("/api/me/2fa", { cache: "no-store" });
      if (!res.ok) {
        setError("Couldn't load 2FA status.");
        return;
      }
      const data = (await res.json()) as Status;
      setStatus(data);
    } catch {
      setError("Network error loading 2FA status.");
    }
  }

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/2fa/enroll", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Couldn't start enrollment.");
        return;
      }
      setEnrollment(body as Enrollment);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Invalid code — try again.");
        return;
      }
      setEnrollment(null);
      setCode("");
      await loadStatus();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: disablePassword,
          code: disableCode.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Couldn't disable 2FA.");
        return;
      }
      setShowDisable(false);
      setDisablePassword("");
      setDisableCode("");
      await loadStatus();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateBackupCodes() {
    if (!confirm("Replace your existing 10 backup codes with a fresh set? The old codes stop working immediately.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/2fa/backup-codes", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Couldn't regenerate codes.");
        return;
      }
      setNewBackupCodes(body?.backupCodes ?? []);
      await loadStatus();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  // Enrollment flow — show the QR + codes while the user wires it up.
  if (enrollment) {
    return (
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-100">
          Set up your authenticator
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>
            Scan this QR with Google Authenticator, 1Password, Authy,
            or any TOTP app.
          </li>
          <li>
            Save the 10 backup codes below somewhere safe — they let
            you sign in if you lose your device.
          </li>
          <li>Enter the first 6-digit code from your app to confirm.</li>
        </ol>
        <div className="flex justify-center rounded-lg bg-white p-4">
          <img
            alt="2FA QR code"
            width={200}
            height={200}
            src={`https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(enrollment.otpauthUri)}`}
          />
        </div>
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer hover:text-slate-200">
            Can&apos;t scan? Use the manual key.
          </summary>
          <code className="mt-2 block break-all rounded bg-slate-900/60 px-2 py-1 font-mono text-[11px] text-slate-200">
            {enrollment.manualKey}
          </code>
        </details>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            Backup codes — save these now
          </p>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 font-mono text-sm text-amber-100">
            {enrollment.backupCodes.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            You won&apos;t be able to see these again. Each one works
            once. Treat them like a spare key.
          </p>
        </div>
        <div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">
              first verification code
            </span>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="tracking-widest text-center"
            />
          </label>
          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              onClick={confirmCode}
              disabled={busy || !code}
              className="flex-1"
            >
              {busy ? "Verifying…" : "Confirm and enable 2FA"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEnrollment(null);
                setCode("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  // 2FA is currently ON.
  if (status.enabled) {
    return (
      <div className="space-y-4">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-emerald-200">
                Two-factor authentication is on
              </p>
              {status.enabledAt && (
                <p className="text-xs text-emerald-300/70">
                  Enabled{" "}
                  {new Date(status.enabledAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                {status.backupCodesRemaining} backup code
                {status.backupCodesRemaining === 1 ? "" : "s"} remaining
              </p>
            </div>
          </div>
        </Card>

        {newBackupCodes && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
              New backup codes — save these now
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-sm text-amber-100">
              {newBackupCodes.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setNewBackupCodes(null)}
              className="mt-3 text-[11px] text-slate-400 hover:text-slate-200"
            >
              I&apos;ve saved them — dismiss
            </button>
          </Card>
        )}

        <TrustedDevicesPanel />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={regenerateBackupCodes}
            disabled={busy}
          >
            Regenerate backup codes
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowDisable(true)}
            disabled={busy}
            className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15"
          >
            Disable 2FA
          </Button>
        </div>

        {showDisable && (
          <Card className="border-rose-500/30 bg-rose-500/5 space-y-3">
            <p className="text-sm font-semibold text-rose-200">
              Disable two-factor authentication
            </p>
            <p className="text-xs text-slate-400">
              Confirm with your password AND a current TOTP / backup
              code. After disabling, sign-in needs only a password.
            </p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">
                password
              </span>
              <Input
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">
                authenticator code or backup code
              </span>
              <Input
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
              />
            </label>
            {error && <p className="text-xs text-rose-300">{error}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={disable}
                disabled={busy || !disablePassword || !disableCode}
                className="bg-rose-500 hover:bg-rose-500/90"
              >
                {busy ? "Disabling…" : "Disable 2FA"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowDisable(false);
                  setDisablePassword("");
                  setDisableCode("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}
      </div>
    );
  }

  // 2FA is OFF — show the "Enable" CTA.
  return (
    <div className="space-y-3">
      <Card className="text-sm text-slate-300">
        <p className="font-semibold text-slate-100">
          Two-factor authentication is off
        </p>
        <p className="mt-1 text-slate-400">
          Turn it on to require a 6-digit code at sign-in, on top of
          your password. You&apos;ll need any TOTP app (Google
          Authenticator, 1Password, Authy, etc.).
        </p>
      </Card>
      {error && (
        <p className="text-xs text-rose-300">{error}</p>
      )}
      <Button type="button" onClick={startEnrollment} disabled={busy}>
        {busy ? "Starting…" : "Enable 2FA"}
      </Button>
    </div>
  );
}

interface TrustedDevice {
  id: string;
  label: string | null;
  lastSeenAt: string;
  expiresAt: string;
}

/**
 * Lists active trusted-device cookies the user has minted, lets them
 * revoke one or all. Only shown when 2FA is ON (otherwise the rows
 * can't exist — minting requires a 2FA completion).
 */
function TrustedDevicesPanel() {
  const [items, setItems] = useState<TrustedDevice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/me/2fa/trusted-devices", {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Couldn't load trusted devices.");
        return;
      }
      const data = (await res.json()) as { items: TrustedDevice[] };
      setItems(data.items);
    } catch {
      setError("Network error loading trusted devices.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(id: string) {
    if (!confirm("Stop trusting this device? The next sign-in there will need a 2FA code.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/me/2fa/trusted-devices/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Couldn't revoke.");
        return;
      }
      await load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeAll() {
    if (
      !confirm(
        "Revoke every trusted device? You'll need a 2FA code on the next sign-in everywhere — including this browser.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/2fa/trusted-devices/revoke-all", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Couldn't revoke devices.");
        return;
      }
      await load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Trusted devices
        </h3>
        {items.length > 0 && (
          <button
            type="button"
            onClick={revokeAll}
            disabled={busy}
            className="text-[11px] text-rose-300 hover:text-rose-200"
          >
            Revoke all
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Browsers where you ticked &ldquo;Trust this device&rdquo; — they skip the
        2FA code prompt for 90 days. Revoke any you don&apos;t recognise.
      </p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {loaded && items.length === 0 && (
        <p className="text-xs text-slate-500">
          No trusted devices yet. Tick &ldquo;Trust this device&rdquo; the next
          time you complete a 2FA sign-in to add this browser to the list.
        </p>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm"
            >
              <span>
                <span className="block font-medium text-slate-100">
                  {d.label ?? "Unknown device"}
                </span>
                <span className="block text-[11px] text-slate-500">
                  Last seen {new Date(d.lastSeenAt).toLocaleString()} · Expires{" "}
                  {new Date(d.expiresAt).toLocaleDateString()}
                </span>
              </span>
              <button
                type="button"
                onClick={() => revoke(d.id)}
                disabled={busy}
                className="text-[11px] text-rose-300 hover:text-rose-200"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

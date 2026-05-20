"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

interface RgProfile {
  userId: string;
  dailyDepositLimitCoins: number | null;
  weeklyDepositLimitCoins: number | null;
  monthlyDepositLimitCoins: number | null;
  dailyLossLimitCoins: number | null;
  weeklyLossLimitCoins: number | null;
  monthlyLossLimitCoins: number | null;
  dailyWagerLimitCoins: number | null;
  sessionReminderMinutes: number;
  cooldownUntil: string | null;
  selfExcludedUntil: string | null;
  selfExcludedAt: string | null;
}

const LIMIT_FIELDS: Array<{
  key: keyof RgProfile;
  label: string;
  hint: string;
}> = [
  {
    key: "dailyWagerLimitCoins",
    label: "Daily wager limit (coins)",
    hint: "Sum of bid costs per UTC day. Reaching this blocks new bids until midnight UTC.",
  },
  {
    key: "dailyDepositLimitCoins",
    label: "Daily deposit limit (coins)",
    hint: "Maximum coins purchasable per UTC day. Reaching this blocks the next top-up.",
  },
  {
    key: "dailyLossLimitCoins",
    label: "Daily loss limit (coins)",
    hint: "Net coins lost per UTC day across games. Reaching this halts new bets.",
  },
];

/**
 * Client surface. Three panels:
 *
 *   1. Status banner — surfaces an active cooldown / self-exclusion
 *      if present, takes the rest of the page out of the keyboard
 *      flow (limits aren't editable mid-exclusion).
 *   2. Limit editor — sparse PATCH; empty input means "leave unset".
 *      Backend refuses to raise, so a raise attempt surfaces the
 *      server error inline.
 *   3. Cool-down + self-exclusion buttons — duration picker, no
 *      cancellation affordance (regulatory).
 */
export function ResponsibleGamblingClient({
  initialProfile,
}: {
  initialProfile: RgProfile;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(
      LIMIT_FIELDS.map((f) => [
        f.key,
        profile[f.key] == null ? "" : String(profile[f.key]),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Cool-down + self-exclusion picks.
  const [cooldownDuration, setCooldownDuration] =
    useState<"day1" | "day7" | "day30" | "day90">("day1");
  const [excludeDuration, setExcludeDuration] =
    useState<"day7" | "day30" | "day90" | "permanent">("day7");
  const [confirmExclude, setConfirmExclude] = useState(false);

  const cooldownActive =
    profile.cooldownUntil != null &&
    new Date(profile.cooldownUntil).getTime() > Date.now();
  const excluded =
    profile.selfExcludedAt != null &&
    (profile.selfExcludedUntil == null ||
      new Date(profile.selfExcludedUntil).getTime() > Date.now());

  const blocked = cooldownActive || excluded;

  async function saveLimits() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const body: Record<string, number | null> = {};
    for (const f of LIMIT_FIELDS) {
      const raw = drafts[f.key as string]?.trim();
      const current = profile[f.key] as number | null;
      if (raw === "" && current == null) continue;             // unchanged
      if (raw === "" && current != null) {
        // User wiped the input — that's a raise attempt; will 400.
        body[f.key as string] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        setError(`${f.label} must be a whole number ≥ 0.`);
        setBusy(false);
        return;
      }
      if (n !== current) body[f.key as string] = n;
    }
    if (Object.keys(body).length === 0) {
      setSuccess("Nothing to save.");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/me/rg/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? "Couldn't save.");
        return;
      }
      setProfile(data as RgProfile);
      setSuccess("Saved.");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function startCooldown() {
    if (!confirm(
      `Start a ${labelForDuration(cooldownDuration)} cool-down? You will be signed out and unable to sign in until it ends. Cool-downs cannot be cancelled early.`,
    )) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/rg/cooldown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: cooldownDuration }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? "Couldn't start cool-down.");
        return;
      }
      setProfile((p) => ({ ...p, cooldownUntil: data?.cooldownUntil ?? null }));
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function startSelfExclusion() {
    if (!confirmExclude) {
      setConfirmExclude(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/rg/self-exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: excludeDuration }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? "Couldn't start self-exclusion.");
        return;
      }
      setProfile((p) => ({
        ...p,
        selfExcludedAt: data?.selfExcludedAt ?? null,
        selfExcludedUntil: data?.selfExcludedUntil ?? null,
      }));
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {excluded && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <p className="font-semibold text-rose-200">Self-exclusion active</p>
          <p className="mt-1 text-xs text-slate-300">
            Sign-in is blocked
            {profile.selfExcludedUntil
              ? ` until ${new Date(profile.selfExcludedUntil).toLocaleString()}`
              : " indefinitely"}
            . Contact support for help — you can reach the National Helpline
            at 1800-599-0019.
          </p>
        </Card>
      )}

      {!excluded && cooldownActive && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <p className="font-semibold text-amber-200">Cool-down active</p>
          <p className="mt-1 text-xs text-slate-300">
            Sign-in is blocked until{" "}
            {new Date(profile.cooldownUntil!).toLocaleString()}. Cool-downs
            cannot be cancelled early — that&apos;s by design.
          </p>
        </Card>
      )}

      <Card className={blocked ? "opacity-60 pointer-events-none" : ""}>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Limits
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Lower = takes effect immediately. Raise / remove = call support.
        </p>
        <div className="space-y-3">
          {LIMIT_FIELDS.map((f) => (
            <label key={f.key as string} className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">
                {f.label}
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={drafts[f.key as string] ?? ""}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [f.key as string]: e.target.value }))
                }
                placeholder="no limit"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                {f.hint}
              </span>
            </label>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        {success && <p className="mt-3 text-xs text-emerald-300">{success}</p>}
        <div className="mt-3">
          <Button type="button" onClick={saveLimits} disabled={busy}>
            {busy ? "Saving…" : "Save limits"}
          </Button>
        </div>
      </Card>

      <Card className={blocked ? "opacity-60 pointer-events-none" : ""}>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Take a break (cool-down)
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Blocks sign-in for the selected duration. Cannot be cancelled.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={cooldownDuration}
            onChange={(e) =>
              setCooldownDuration(e.target.value as typeof cooldownDuration)
            }
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
          >
            <option value="day1">24 hours</option>
            <option value="day7">7 days</option>
            <option value="day30">30 days</option>
            <option value="day90">90 days</option>
          </select>
          <Button
            type="button"
            variant="secondary"
            onClick={startCooldown}
            disabled={busy}
          >
            Start cool-down
          </Button>
        </div>
      </Card>

      <Card
        className={
          blocked
            ? "opacity-60 pointer-events-none"
            : "border-rose-500/30 bg-rose-500/5"
        }
      >
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-rose-200">
          Self-exclude
        </h2>
        <p className="mb-3 text-xs text-slate-300">
          A stronger version of cool-down. The account is fully closed
          for the duration. Permanent self-exclusion can only be
          reversed by contacting support after a cool-off period —
          choose it only when you want to stop for good.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={excludeDuration}
            onChange={(e) => {
              setExcludeDuration(e.target.value as typeof excludeDuration);
              setConfirmExclude(false);
            }}
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
          >
            <option value="day7">7 days</option>
            <option value="day30">30 days</option>
            <option value="day90">90 days</option>
            <option value="permanent">Permanent</option>
          </select>
          <Button
            type="button"
            onClick={startSelfExclusion}
            disabled={busy}
            className="border-rose-500/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
            variant="secondary"
          >
            {confirmExclude
              ? `Confirm self-exclusion (${labelForDuration(excludeDuration)})`
              : "Self-exclude"}
          </Button>
          {confirmExclude && (
            <button
              type="button"
              onClick={() => setConfirmExclude(false)}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

function labelForDuration(d: string): string {
  switch (d) {
    case "day1":
      return "24 hours";
    case "day7":
      return "7 days";
    case "day30":
      return "30 days";
    case "day90":
      return "90 days";
    case "permanent":
      return "permanent";
    default:
      return d;
  }
}

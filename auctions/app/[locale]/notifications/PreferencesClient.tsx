"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { NotificationPreferences } from "@/lib/backend";

/**
 * Notification-preferences toggle panel. Client island — the parent
 * notifications page is server-rendered, this widget mounts only
 * when the user actually flips a toggle.
 *
 * Each toggle writes to `/api/notifications/preferences` immediately
 * on change (optimistic update + rollback on error). No "Save"
 * button — small switches feel better than a multi-step form for
 * this kind of personal setting.
 *
 * The `responsibleGambling` row is surfaced as a read-only toggle
 * for transparency (the server force-trues it on every write,
 * regulatory requirement — see backend `preferences.controller.ts`).
 */
const ROWS: Array<{
  key: keyof NotificationPreferences;
  label: string;
  description: string;
  locked?: boolean;
}> = [
  {
    key: "outbid",
    label: "Outbid alerts",
    description: "When someone places a lower unique bid on an auction you're watching.",
  },
  {
    key: "auctionEnding",
    label: "Auction ending soon",
    description: "30 minutes before an auction you're watching closes.",
  },
  {
    key: "orderUpdates",
    label: "Order updates",
    description: "Shipping address, tracking, delivery confirmation for items you've won.",
  },
  {
    key: "dailyStreak",
    label: "Daily streak reminders",
    description: "When today's claim is ready (your local timezone).",
  },
  {
    key: "marketingPush",
    label: "Promotions (push)",
    description: "New auctions, weekly highlights, special events.",
  },
  {
    key: "marketingEmail",
    label: "Promotions (email)",
    description: "Same content as the push opt-in, via email.",
  },
  {
    key: "responsibleGambling",
    label: "Responsible gambling alerts",
    description: "Deposit limit hit, cool-down activated, self-exclusion confirmation. Cannot be disabled (regulatory).",
    locked: true,
  },
];

export function PreferencesClient({
  initial,
}: {
  initial: NotificationPreferences;
}) {
  const [prefs, setPrefs] = useState<NotificationPreferences>(initial);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: keyof NotificationPreferences) {
    if (ROWS.find((r) => r.key === key)?.locked) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSavingKey(String(key));
    setError(null);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: next[key] }),
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const fresh = (await res.json()) as NotificationPreferences;
      setPrefs(fresh);
    } catch (e) {
      setPrefs(prefs);                       // rollback optimistic flip
      setError(e instanceof Error ? e.message : "Failed to save preference.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card className="mt-3 divide-y divide-slate-800/60">
      {ROWS.map((row) => (
        <div
          key={row.key}
          className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100">{row.label}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              {row.description}
            </p>
          </div>
          <Toggle
            checked={prefs[row.key]}
            onChange={() => toggle(row.key)}
            disabled={row.locked || savingKey === row.key}
            label={row.label}
          />
        </div>
      ))}
      {error && <p className="pt-2 text-xs text-rose-300">{error}</p>}
    </Card>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition disabled:cursor-not-allowed ${
        checked ? "bg-emerald-500" : "bg-slate-800"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md transition ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Input,
  toast,
} from "@/components/admin/ui/primitives";

/**
 * Live-editable settings table (PR-BET-ADMIN-REDESIGN).
 *
 * Renders the catalogue grouped by category; each row has an inline
 * editor matching the declared type. Save is row-level (no global
 * "save all") so concurrent edits don't stomp on each other.
 */

interface SettingRow {
  key: string;
  label: string;
  type: "number" | "boolean" | "string" | "json";
  category: string;
  description: string;
  value: unknown;
  defaultValue: unknown;
  updatedAt: string | null;
}

export function SettingsClient({ settings }: { settings: SettingRow[] }) {
  const grouped = new Map<string, SettingRow[]>();
  for (const s of settings) {
    const arr = grouped.get(s.category) ?? [];
    arr.push(s);
    grouped.set(s.category, arr);
  }

  return (
    <div className="space-y-5">
      {Array.from(grouped.entries()).map(([category, items]) => (
        <Card key={category} className="overflow-hidden">
          <div className="border-b border-[var(--admin-divider)] px-4 py-3">
            <div className="text-sm font-bold uppercase tracking-wider text-[var(--admin-text-primary)]">
              {category}
            </div>
          </div>
          <ul className="divide-y divide-[var(--admin-divider)]">
            {items.map((s) => (
              <SettingItem key={s.key} setting={s} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function SettingItem({ setting }: { setting: SettingRow }) {
  const [draft, setDraft] = useState<string>(String(setting.value ?? ""));
  const [busy, setBusy] = useState(false);
  const dirty = draft !== String(setting.value ?? "");

  async function save() {
    setBusy(true);
    try {
      let parsedValue: unknown = draft;
      if (setting.type === "number") parsedValue = Number(draft);
      else if (setting.type === "boolean") parsedValue = draft === "true";
      else if (setting.type === "json") parsedValue = JSON.parse(draft);
      const res = await fetch(`/api/admin/settings/${encodeURIComponent(setting.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: parsedValue,
          type: setting.type,
          category: setting.category,
          description: setting.description,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      toast.success(`${setting.label} updated.`);
      // Reload so the server-rendered value picks up the new state.
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--admin-text-primary)]">
              {setting.label}
            </span>
            <code className="rounded bg-[var(--admin-elevated)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--admin-text-muted)]">
              {setting.key}
            </code>
            <Badge>{setting.type}</Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--admin-text-secondary)]">{setting.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {setting.type === "boolean" ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-9 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-elevated)] px-3 text-sm"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-40"
            />
          )}
          <Button variant="primary" size="sm" onClick={save} loading={busy} disabled={!dirty}>
            Save
          </Button>
        </div>
      </div>
    </li>
  );
}

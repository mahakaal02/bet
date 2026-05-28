"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";
import type { MarketCategory } from "@prisma/client";

interface GroupFormProps {
  group?: {
    id: string;
    title: string;
    description: string | null;
    category: MarketCategory;
    type: "EXCLUSIVE" | "INDEPENDENT";
    status: "OPEN" | "CLOSED" | "RESOLVED" | "CANCELLED";
    featured: boolean;
    sortOrder: number;
  };
}

const CATEGORIES: MarketCategory[] = [
  "POLITICS",
  "SPORTS",
  "CRYPTO",
  "TECH",
  "ENTERTAINMENT",
];

/**
 * Create / edit an event (market group). Mirrors `MarketForm`'s shape and
 * styling. A RESOLVED/CANCELLED group is frozen — inputs disable and the
 * server rejects edits with `cannot_edit_resolved`, so the UI just mirrors.
 */
export function GroupForm({ group }: GroupFormProps) {
  const router = useRouter();
  const editing = !!group;
  const frozen = group?.status === "RESOLVED" || group?.status === "CANCELLED";
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: group?.title ?? "",
    description: group?.description ?? "",
    category: group?.category ?? ("POLITICS" as MarketCategory),
    type: group?.type ?? ("EXCLUSIVE" as "EXCLUSIVE" | "INDEPENDENT"),
    status: (group?.status === "CLOSED" ? "CLOSED" : "OPEN") as "OPEN" | "CLOSED",
    featured: group?.featured ?? false,
    sortOrder: group?.sortOrder != null ? String(group.sortOrder) : "0",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (frozen) return;
    setBusy(true);
    try {
      const url = editing
        ? `/api/admin/market-groups/${group.id}`
        : "/api/admin/market-groups";
      const method = editing ? "PATCH" : "POST";
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        category: form.category,
        type: form.type,
        featured: form.featured,
        sortOrder: form.sortOrder === "" ? 0 : Number(form.sortOrder),
      };
      // status only toggles OPEN/CLOSED here; settlement sets the final states.
      if (editing) payload.status = form.status;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? "Save failed.", "err");
        return;
      }
      toast(editing ? "Saved." : "Event created.", "ok");
      if (!editing && body.id) {
        router.push(`/admin/groups/${body.id}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label="Title">
        <Input
          required
          maxLength={140}
          disabled={frozen}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Who will win the 2028 election?"
        />
      </Field>
      <Field label="Description (optional)">
        <textarea
          rows={3}
          maxLength={2000}
          disabled={frozen}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-60"
          placeholder="Shown on the event page header."
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select
            value={form.category}
            disabled={frozen}
            onChange={(e) =>
              setForm({ ...form, category: e.target.value as MarketCategory })
            }
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm disabled:opacity-60"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            value={form.type}
            disabled={frozen}
            onChange={(e) =>
              setForm({
                ...form,
                type: e.target.value as "EXCLUSIVE" | "INDEPENDENT",
              })
            }
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm disabled:opacity-60"
          >
            <option value="EXCLUSIVE">Exclusive (one winner, % sums to 100)</option>
            <option value="INDEPENDENT">Independent (raw YES%)</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sort order">
          <Input
            type="number"
            min={0}
            disabled={frozen}
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            placeholder="0"
          />
        </Field>
        {editing && (
          <Field label="Status">
            <select
              value={form.status}
              disabled={frozen}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as "OPEN" | "CLOSED" })
              }
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm disabled:opacity-60"
            >
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.featured}
          disabled={frozen}
          onChange={(e) => setForm({ ...form, featured: e.target.checked })}
          className="h-4 w-4 rounded border-slate-700 bg-slate-900"
        />
        Featured
      </label>

      {!frozen && (
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create event"}
          </Button>
        </div>
      )}
      {frozen && (
        <p className="pt-1 text-xs text-slate-500">
          This event is settled and can no longer be edited.
        </p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

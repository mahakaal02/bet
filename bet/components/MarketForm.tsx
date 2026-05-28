"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";
import type { MarketCategory } from "@prisma/client";

interface MarketFormProps {
  market?: {
    id: string;
    title: string;
    description: string;
    bannerUrl: string | null;
    category: MarketCategory;
    resolutionSource: string | null;
    endsAt: string;
    featured: boolean;
    groupId?: string | null;
    groupSortOrder?: number | null;
  };
  /** Available events/groups to optionally attach this market to. */
  groups?: { id: string; title: string }[];
}

const CATEGORIES: MarketCategory[] = [
  "POLITICS",
  "SPORTS",
  "CRYPTO",
  "TECH",
  "ENTERTAINMENT",
];

export function MarketForm({ market, groups = [] }: MarketFormProps) {
  const router = useRouter();
  const editing = !!market;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: market?.title ?? "",
    description: market?.description ?? "",
    bannerUrl: market?.bannerUrl ?? "",
    category: market?.category ?? "POLITICS",
    resolutionSource: market?.resolutionSource ?? "",
    endsAt: market ? toLocalDatetime(market.endsAt) : defaultEndsAt(),
    featured: market?.featured ?? false,
    groupId: market?.groupId ?? "",
    groupSortOrder:
      market?.groupSortOrder != null ? String(market.groupSortOrder) : "",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const url = editing
        ? `/api/admin/markets/${market.id}`
        : "/api/admin/markets";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          endsAt: new Date(form.endsAt).toISOString(),
          // "" → standalone (API coerces falsy groupId to null). Sort order is
          // only meaningful inside a group; numeric or null on the wire.
          groupId: form.groupId || null,
          groupSortOrder:
            form.groupId && form.groupSortOrder !== ""
              ? Number(form.groupSortOrder)
              : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? "Save failed.", "err");
        return;
      }
      toast(editing ? "Saved." : "Market created.", "ok");
      if (!editing && body.slug) {
        router.push(`/admin/markets/${body.id}`);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!editing) return;
    if (!confirm("Delete this market? Bids and positions will be removed.")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/markets/${market.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      toast("Deleted.", "ok");
      router.push("/admin");
    } else {
      toast("Could not delete.", "err");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label="Title">
        <Input
          required
          maxLength={140}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Will X happen by Y?"
        />
      </Field>
      <Field label="Description">
        <textarea
          required
          rows={4}
          maxLength={2000}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          placeholder="What does YES mean here? Where will it resolve?"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select
            value={form.category}
            onChange={(e) =>
              setForm({ ...form, category: e.target.value as MarketCategory })
            }
            className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ends at">
          <Input
            type="datetime-local"
            required
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Banner image URL (optional)">
        <Input
          type="url"
          value={form.bannerUrl}
          onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })}
          placeholder="https://images.unsplash.com/…"
        />
      </Field>
      <Field label="Resolution source (optional)">
        <Input
          value={form.resolutionSource}
          onChange={(e) =>
            setForm({ ...form, resolutionSource: e.target.value })
          }
          placeholder="The Associated Press / official press release / …"
        />
      </Field>
      {(groups.length > 0 || form.groupId) && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Event / group (optional)">
            <select
              value={form.groupId}
              onChange={(e) => setForm({ ...form, groupId: e.target.value })}
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-sm"
            >
              <option value="">— None (standalone) —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sort order in event">
            <Input
              type="number"
              min={0}
              value={form.groupSortOrder}
              disabled={!form.groupId}
              onChange={(e) =>
                setForm({ ...form, groupSortOrder: e.target.value })
              }
              placeholder="0"
            />
          </Field>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.featured}
          onChange={(e) => setForm({ ...form, featured: e.target.checked })}
          className="h-4 w-4 rounded border-slate-700 bg-slate-900"
        />
        Featured (pin on landing page)
      </label>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Create market"}
        </Button>
        {editing && (
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </Button>
        )}
      </div>
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

function defaultEndsAt(): string {
  const t = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return toLocalDatetime(t);
}

function toLocalDatetime(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

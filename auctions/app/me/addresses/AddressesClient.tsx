"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import type { Address } from "./page";

/**
 * List + add + edit + delete + set-default.
 *
 * The list lives in component state; on each mutation we update
 * locally THEN call router.refresh() so the server-rendered shell
 * stays in sync without a hard reload.
 *
 * One form component is reused for both create and edit — the
 * `editing` state holds the id (or null for "new").
 */

const BLANK: Omit<Address, "id" | "createdAt" | "updatedAt"> = {
  fullName: "",
  phoneE164: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  countryIso2: "IN",
  isDefault: false,
};

export function AddressesClient({ initial }: { initial: Address[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Address[]>(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setEditing("new");
    setDraft({ ...BLANK, isDefault: items.length === 0 });
    setError(null);
  }
  function startEdit(a: Address) {
    setEditing(a.id);
    setDraft({
      fullName: a.fullName,
      phoneE164: a.phoneE164,
      line1: a.line1,
      line2: a.line2 ?? "",
      city: a.city,
      state: a.state,
      postalCode: a.postalCode,
      countryIso2: a.countryIso2,
      isDefault: a.isDefault,
    });
    setError(null);
  }
  function cancelEdit() {
    setEditing(null);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const url =
        editing === "new"
          ? "/api/me/addresses"
          : `/api/me/addresses/${editing}`;
      const method = editing === "new" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          line2: draft.line2?.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "Couldn't save address.");
        return;
      }
      // Re-fetch to keep the order + default flag consistent
      // (creating with isDefault=true demotes others server-side).
      const next = await fetch("/api/me/addresses", { cache: "no-store" });
      if (next.ok) {
        const j = (await next.json()) as { items: Address[] };
        setItems(j.items);
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/addresses/${id}/default`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Couldn't update default.");
        return;
      }
      const next = await fetch("/api/me/addresses", { cache: "no-store" });
      if (next.ok) {
        const j = (await next.json()) as { items: Address[] };
        setItems(j.items);
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function destroy(a: Address) {
    if (!confirm(`Delete the address at ${a.line1}, ${a.city}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/addresses/${a.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Couldn't delete address.");
        return;
      }
      const next = await fetch("/api/me/addresses", { cache: "no-store" });
      if (next.ok) {
        const j = (await next.json()) as { items: Address[] };
        setItems(j.items);
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-rose-500/30 bg-rose-500/10 text-sm text-rose-100">
          {error}
        </Card>
      )}

      {items.length === 0 && editing !== "new" && (
        <Card className="text-sm text-slate-400">
          No saved addresses yet. Add one so we can ship your wins.
        </Card>
      )}

      {items.map((a) =>
        editing === a.id ? (
          <Card key={a.id}>
            <AddressForm
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              onSave={save}
              onCancel={cancelEdit}
              isFirst={false}
            />
          </Card>
        ) : (
          <Card key={a.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">
                    {a.fullName}
                  </span>
                  {a.isDefault && (
                    <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
                      default
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-300">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ""}
                </p>
                <p className="text-sm text-slate-300">
                  {a.city}, {a.state} {a.postalCode}
                </p>
                <p className="text-xs text-slate-500">
                  {a.countryIso2} · {a.phoneE164}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => startEdit(a)}
              >
                Edit
              </Button>
              {!a.isDefault && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDefault(a.id)}
                  disabled={busy}
                >
                  Set as default
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => destroy(a)}
                disabled={busy}
                className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15"
              >
                Delete
              </Button>
            </div>
          </Card>
        ),
      )}

      {editing === "new" ? (
        <Card>
          <AddressForm
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onSave={save}
            onCancel={cancelEdit}
            isFirst={items.length === 0}
          />
        </Card>
      ) : (
        <Button type="button" onClick={startCreate} disabled={busy}>
          + Add address
        </Button>
      )}
    </div>
  );
}

function AddressForm({
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
  isFirst,
}: {
  draft: Omit<Address, "id" | "createdAt" | "updatedAt">;
  setDraft: (
    d: Omit<Address, "id" | "createdAt" | "updatedAt">,
  ) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  isFirst: boolean;
}) {
  return (
    <div className="space-y-3">
      <Field label="full name">
        <Input
          value={draft.fullName}
          onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
          maxLength={100}
        />
      </Field>
      <Field label="phone (E.164, e.g. +919876543210)">
        <Input
          value={draft.phoneE164}
          onChange={(e) => setDraft({ ...draft, phoneE164: e.target.value })}
          maxLength={20}
        />
      </Field>
      <Field label="address line 1">
        <Input
          value={draft.line1}
          onChange={(e) => setDraft({ ...draft, line1: e.target.value })}
          maxLength={200}
        />
      </Field>
      <Field label="address line 2 (optional)">
        <Input
          value={draft.line2 ?? ""}
          onChange={(e) => setDraft({ ...draft, line2: e.target.value })}
          maxLength={200}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="city">
          <Input
            value={draft.city}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            maxLength={100}
          />
        </Field>
        <Field label="state">
          <Input
            value={draft.state}
            onChange={(e) => setDraft({ ...draft, state: e.target.value })}
            maxLength={64}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="PIN / postal code">
          <Input
            value={draft.postalCode}
            onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })}
            maxLength={16}
          />
        </Field>
        <Field label="country (ISO 3166-1 α-2)">
          <Input
            value={draft.countryIso2}
            onChange={(e) =>
              setDraft({ ...draft, countryIso2: e.target.value.toUpperCase() })
            }
            maxLength={2}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={draft.isDefault}
          onChange={(e) =>
            setDraft({ ...draft, isDefault: e.target.checked })
          }
          disabled={isFirst}
        />
        <span>
          Make this my default address{" "}
          {isFirst && (
            <span className="text-[11px] text-slate-500">
              (first address is always default)
            </span>
          )}
        </span>
      </label>
      <div className="flex gap-2">
        <Button type="button" onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

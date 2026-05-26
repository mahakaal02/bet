"use client";

import { useCallback, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import type { DocumentKind, KycStatus, KycTier } from "./page";

const TIER_DESCRIPTIONS: Record<KycTier, { label: string; subtitle: string }> = {
  TIER_0: { label: "Tier 0", subtitle: "Signed up — no withdrawals yet" },
  TIER_1: { label: "Tier 1", subtitle: "Email + phone verified — small withdrawals" },
  TIER_2: { label: "Tier 2", subtitle: "Identity verified — moderate withdrawals" },
  TIER_3: { label: "Tier 3", subtitle: "Full KYC — unlimited withdrawals" },
};

const DOC_LABELS: Record<DocumentKind, string> = {
  PAN: "PAN card",
  AADHAAR_LAST4: "Aadhaar (last 4)",
  PASSPORT: "Passport",
  VOTER_ID: "Voter ID",
  ADDRESS_PROOF: "Address proof",
  SELFIE: "Selfie",
  LIVENESS_VIDEO: "Liveness video",
};

const MAX_BYTES = 10 * 1024 * 1024;
const KIND_OPTIONS: { kind: DocumentKind; mime: string }[] = [
  { kind: "PAN", mime: "image/jpeg,image/png,application/pdf" },
  { kind: "PASSPORT", mime: "image/jpeg,image/png,application/pdf" },
  { kind: "VOTER_ID", mime: "image/jpeg,image/png,application/pdf" },
  { kind: "SELFIE", mime: "image/jpeg,image/png" },
  { kind: "ADDRESS_PROOF", mime: "image/jpeg,image/png,application/pdf" },
];

/**
 * Three-section wizard.
 *
 *   - **Current status** — tier card + cap copy + email/phone marks
 *   - **Upload** — single picker w/ a `kind` dropdown. Keeps the UI
 *     simple at the cost of one extra click vs a per-kind tile —
 *     the picker chooses the file first, the dropdown stamps it.
 *   - **History** — list of submissions w/ review + scan state.
 *
 * After a successful upload we *don't* re-fetch the full page; we
 * pop the returned doc into the local list. The server reply
 * already carries the new tier (if any) so the cap copy refreshes
 * without an extra round-trip.
 */
export function KycClient({ initial }: { initial: KycStatus }) {
  const [status, setStatus] = useState<KycStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>("PAN");
  const [file, setFile] = useState<File | null>(null);

  const description = TIER_DESCRIPTIONS[status.tier];
  const capCopy = useMemo(() => {
    if (status.maxWithdrawalCoins === null) return "Unlimited withdrawals.";
    if (status.maxWithdrawalCoins === 0) return "Withdrawals locked at this tier.";
    return `Withdrawals up to ${status.maxWithdrawalCoins.toLocaleString("en-IN")} coins.`;
  }, [status.maxWithdrawalCoins]);

  const upload = useCallback(async () => {
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File is over 10 MiB.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await fetch("/api/me/kyc/document", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (body as { code?: string }).code ?? body?.error ?? "Upload failed.";
        throw new Error(code);
      }
      // Refetch the full status so the doc list + tier reflect.
      const fresh = await fetch("/api/me/kyc", { cache: "no-store" }).then((r) => r.json());
      setStatus(fresh);
      setFile(null);
      setSuccess("Uploaded — Kalki's team will review shortly.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }, [file, kind]);

  return (
    <div className="space-y-4">
      {/* Tier + cap */}
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Current status
            </div>
            <div className="mt-1 text-lg font-black text-amber-200">
              {description.label}
            </div>
            <p className="text-[11px] text-slate-500">{description.subtitle}</p>
          </div>
          <TierBadge tier={status.tier} />
        </div>
        <p className="text-sm text-slate-300">{capCopy}</p>
      </Card>

      {/* Verification list */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Checklist
        </h2>
        <ul className="space-y-2 text-sm text-slate-300">
          <ChecklistRow
            label="Email verified"
            done={!!status.emailVerifiedAt}
          />
          <ChecklistRow
            label="Phone verified"
            done={!!status.phoneVerifiedAt}
          />
          <ChecklistRow
            label="Identity document approved"
            done={!!status.identityVerifiedAt}
          />
          <ChecklistRow
            label="Address proof approved (Tier 3)"
            done={!!status.addressVerifiedAt}
          />
        </ul>
      </Card>

      {/* Upload */}
      <Card className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Upload document
        </h2>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-500">Document type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DocumentKind)}
            className="w-full rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.kind} value={opt.kind}>
                {DOC_LABELS[opt.kind]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-slate-500">File (≤ 10 MiB)</span>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            accept={KIND_OPTIONS.find((k) => k.kind === kind)?.mime ?? "image/*,application/pdf"}
            className="block w-full rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-slate-100"
          />
        </label>

        {error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {success}
          </div>
        )}

        <button
          type="button"
          disabled={busy || !file}
          onClick={upload}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Submit for review"}
        </button>
      </Card>

      {/* History */}
      {status.documents.length > 0 && (
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            History
          </h2>
          <ul className="space-y-2 text-sm text-slate-300">
            {status.documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2"
              >
                <span>
                  <span className="block font-medium">{DOC_LABELS[d.kind]}</span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(d.createdAt).toLocaleString()}
                  </span>
                </span>
                <ReviewBadge state={d.reviewState} scan={d.virusScanStatus} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function TierBadge({ tier }: { tier: KycTier }) {
  const cls = {
    TIER_0: "border-slate-600 bg-slate-700/40 text-slate-300",
    TIER_1: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
    TIER_2: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    TIER_3: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  }[tier];
  return (
    <span
      className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${cls}`}
    >
      {tier.replace("_", " ")}
    </span>
  );
}

function ChecklistRow({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
          done ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-700/40 text-slate-500"
        }`}
      >
        {done ? "✓" : "·"}
      </span>
      <span className={done ? "text-slate-200" : "text-slate-400"}>{label}</span>
    </li>
  );
}

function ReviewBadge({ state, scan }: { state: string; scan: string }) {
  if (scan === "INFECTED") {
    return (
      <span className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-200">
        Infected
      </span>
    );
  }
  const cls = {
    PENDING: "border-slate-600 text-slate-400",
    APPROVED: "border-emerald-500/40 text-emerald-200",
    REJECTED: "border-rose-500/40 text-rose-200",
    REQUIRES_RESUBMIT: "border-amber-500/40 text-amber-200",
    NONE: "border-slate-600 text-slate-500",
  }[state as "PENDING" | "APPROVED" | "REJECTED" | "REQUIRES_RESUBMIT" | "NONE"] ??
    "border-slate-600 text-slate-500";
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {state.replace("_", " ").toLowerCase()}
    </span>
  );
}

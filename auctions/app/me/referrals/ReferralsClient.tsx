"use client";

import { useCallback, useState } from "react";
import { Card } from "@/components/ui/Card";
import type { ReferralSummary } from "./page";

/**
 * Client-side bits of the referrals page:
 *
 *   - Copy-to-clipboard for the code + a pre-built share URL.
 *   - Code-claim form for users who didn't bind a referrer at signup.
 *
 * The tally numbers and code come from the SSR layer; the client
 * only owns the interactive state.
 */
export function ReferralsClient({ initial }: { initial: ReferralSummary }) {
  const [summary, setSummary] = useState(initial);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "fail">("idle");
  const [claimCode, setClaimCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/signup?ref=${summary.code}`
    : `https://kalki.example/signup?ref=${summary.code}`;

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopyState("copied");
        setTimeout(() => setCopyState("idle"), 1500);
      } catch {
        setCopyState("fail");
      }
    },
    [],
  );

  const submitClaim = useCallback(async () => {
    if (claimCode.trim().length < 4) {
      setError("Codes are 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/me/referrals/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: claimCode.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (body as { code?: string }).code;
        const map: Record<string, string> = {
          REFERRAL_CODE_NOT_FOUND: "That code doesn't match any user.",
          REFERRAL_SELF_REFUSED: "You can't use your own code.",
          REFERRAL_ALREADY_CLAIMED: "You're already linked to a referrer.",
        };
        throw new Error(map[code ?? ""] ?? body?.message ?? "Claim failed.");
      }
      setSuccess(
        "Linked. You'll both get a bonus once you verify your account and top up coins.",
      );
      // The page-level counts don't change here (status is PENDING),
      // but a future fetch will reflect it; refresh inline summary.
      setSummary({
        ...summary,
        counts: { ...summary.counts, PENDING: summary.counts.PENDING + 1 },
      });
      setClaimCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed.");
    } finally {
      setBusy(false);
    }
  }, [claimCode, summary]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Your code
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-mono text-2xl font-black text-amber-200">{summary.code}</span>
            <button
              type="button"
              onClick={() => void copy(summary.code)}
              className="rounded-md border border-slate-600 bg-slate-800/60 px-2 py-1 text-xs text-slate-200 hover:border-cyan-500/40"
            >
              {copyState === "copied" ? "Copied" : copyState === "fail" ? "Copy failed" : "Copy code"}
            </button>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Share link
          </div>
          <div className="mt-1 flex items-center gap-3">
            <code className="flex-1 truncate rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-300">
              {shareUrl}
            </code>
            <button
              type="button"
              onClick={() => void copy(shareUrl)}
              className="rounded-md border border-slate-600 bg-slate-800/60 px-2 py-1 text-xs text-slate-200 hover:border-cyan-500/40"
            >
              Copy link
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Your referrals
        </h2>
        <ul className="grid grid-cols-2 gap-2 text-sm">
          <Tally label="Pending qualification" value={summary.counts.PENDING} />
          <Tally label="Qualified — payout queued" value={summary.counts.QUALIFIED} />
          <Tally label="Paid out" value={summary.counts.PAID} accent />
          <Tally label="Voided" value={summary.counts.VOIDED} muted />
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Total earned: <span className="font-mono text-amber-200">{summary.totalCoinsEarned.toLocaleString("en-IN")} coins</span>
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Someone referred you?
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Paste their code here. One-shot — choose carefully.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
            placeholder="ABCD2345"
            maxLength={16}
            className="flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 font-mono text-sm uppercase tracking-wider text-slate-100"
          />
          <button
            type="button"
            disabled={busy || claimCode.trim().length < 4}
            onClick={() => void submitClaim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {busy ? "Linking…" : "Link"}
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {success}
          </div>
        )}
      </Card>
    </div>
  );
}

function Tally({ label, value, accent, muted }: { label: string; value: number; accent?: boolean; muted?: boolean }) {
  return (
    <li
      className={`rounded-md border px-3 py-2 ${
        accent
          ? "border-emerald-500/40 bg-emerald-500/10"
          : muted
            ? "border-slate-700 bg-slate-900/40 opacity-70"
            : "border-slate-700 bg-slate-900/60"
      }`}
    >
      <div className="text-[11px] text-slate-400">{label}</div>
      <div
        className={`mt-1 text-lg font-black ${
          accent ? "text-emerald-200" : "text-slate-100"
        }`}
      >
        {value}
      </div>
    </li>
  );
}

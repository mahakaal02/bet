"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";
import { cn, fmtCoins } from "@/lib/utils";

interface Props {
  available: number;
  min: number;
}

type Method = "UPI" | "BANK";

/**
 * Withdrawal form. Two payout methods, switched via tab:
 *
 *   - UPI: single field, validated against the standard `name@bank` shape
 *   - BANK: account number + IFSC (regex-validated) + beneficiary name
 *
 * Client validation mirrors the server-side Zod schema; the server is the
 * authority — these client checks just give faster feedback. Amount input
 * is bound to the wallet balance so a user can't even type a number > what
 * they have.
 */
export function WithdrawForm({ available, min }: Props) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("UPI");
  const [amount, setAmount] = useState<string>(String(min));
  const [upiId, setUpiId] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const amt = Number(amount);
  const amountValid =
    Number.isFinite(amt) && Number.isInteger(amt) && amt >= min && amt <= available;

  const methodValid =
    method === "UPI"
      ? /^[\w.\-]{2,256}@[\w]{2,64}$/.test(upiId)
      : /^\d{6,20}$/.test(accountNumber) &&
        /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase()) &&
        beneficiaryName.trim().length >= 2;

  const valid = amountValid && methodValid;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      const body =
        method === "UPI"
          ? {
              payoutMethod: "UPI",
              amountCoins: amt,
              upiId: upiId.trim(),
            }
          : {
              payoutMethod: "BANK",
              amountCoins: amt,
              accountNumber: accountNumber.trim(),
              ifsc: ifsc.trim().toUpperCase(),
              beneficiaryName: beneficiaryName.trim(),
            };
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(prettyError(data.error), "err");
        return;
      }
      toast("Withdrawal submitted — we'll email when admin decides.", "ok");
      // Clear form for the next request and refresh server-rendered list.
      setUpiId("");
      setAccountNumber("");
      setIfsc("");
      setBeneficiaryName("");
      setAmount(String(min));
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["UPI", "BANK"] as Method[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={cn(
              "flex-1 rounded-lg border py-2 text-sm font-bold",
              method === m
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Amount (coins · ₹1 each)
        </label>
        <Input
          type="number"
          min={min}
          max={available}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
        />
        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            min {fmtCoins(min)} · max {fmtCoins(available)}
          </span>
          {amountValid ? (
            <span className="text-emerald-300">≈ ₹{fmtCoins(amt)} payout</span>
          ) : (
            <span className="text-rose-300">
              {amt > available
                ? "Exceeds wallet balance"
                : amt < min
                  ? `Min ${fmtCoins(min)}`
                  : "Enter a whole number"}
            </span>
          )}
        </div>
      </div>

      {method === "UPI" ? (
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            UPI ID
          </label>
          <Input
            value={upiId}
            onChange={(e) => setUpiId(e.target.value.trim())}
            placeholder="name@bank"
            disabled={busy}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      ) : (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Account number
            </label>
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
              placeholder="6-20 digits"
              maxLength={20}
              disabled={busy}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              IFSC
            </label>
            <Input
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value.toUpperCase())}
              placeholder="HDFC0001234"
              maxLength={11}
              disabled={busy}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Beneficiary name (as on the bank account)
            </label>
            <Input
              value={beneficiaryName}
              onChange={(e) => setBeneficiaryName(e.target.value)}
              maxLength={80}
              disabled={busy}
            />
          </div>
        </>
      )}

      <Button onClick={submit} disabled={!valid || busy} className="w-full">
        {busy ? "Submitting…" : `Request ₹${amountValid ? fmtCoins(amt) : "—"} withdrawal`}
      </Button>
    </div>
  );
}

function prettyError(code?: string): string {
  switch (code) {
    case "insufficient_coins":
      return "Not enough coins in your wallet.";
    case "email_not_verified":
      return "Verify your email before withdrawing.";
    case "rate_limited":
      return "Too many requests — wait before trying again.";
    case "forbidden":
      return "Account isn't allowed to withdraw.";
    case "invalid_input":
      return "Check the form — something looks off.";
    default:
      return "Couldn't submit the request.";
  }
}

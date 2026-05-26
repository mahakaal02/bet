"use client";

import { useState, useTransition } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";
import { cn, fmtCoins } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  isLocale,
  splitLocaleFromPath,
  t,
  type Locale,
} from "@/lib/i18n";

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
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const fromPath = splitLocaleFromPath(pathname ?? "/").locale;
  const locale: Locale = isLocale(params?.locale)
    ? params.locale
    : (fromPath ?? DEFAULT_LOCALE);
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);

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
        toast(prettyError(data.error, tr), "err");
        return;
      }
      toast(tr("withdrawForm.submitSuccess"), "ok");
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
          {tr("withdrawForm.amountLabel")}
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
            {tr("withdrawForm.amountMinMax", {
              min: fmtCoins(min),
              max: fmtCoins(available),
            })}
          </span>
          {amountValid ? (
            <span className="text-emerald-300">
              {tr("withdrawForm.amountPayout", { amount: fmtCoins(amt) })}
            </span>
          ) : (
            <span className="text-rose-300">
              {amt > available
                ? tr("withdrawForm.amountExceeds")
                : amt < min
                  ? tr("withdrawForm.amountMin", { min: fmtCoins(min) })
                  : tr("withdrawForm.amountInteger")}
            </span>
          )}
        </div>
      </div>

      {method === "UPI" ? (
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            {tr("withdrawForm.upiLabel")}
          </label>
          <Input
            value={upiId}
            onChange={(e) => setUpiId(e.target.value.trim())}
            placeholder={tr("withdrawForm.upiPlaceholder")}
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
              {tr("withdrawForm.accountNumberLabel")}
            </label>
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
              placeholder={tr("withdrawForm.accountNumberPlaceholder")}
              maxLength={20}
              disabled={busy}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {tr("withdrawForm.ifscLabel")}
            </label>
            <Input
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value.toUpperCase())}
              placeholder={tr("withdrawForm.ifscPlaceholder")}
              maxLength={11}
              disabled={busy}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {tr("withdrawForm.beneficiaryLabel")}
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
        {busy
          ? tr("withdrawForm.submitting")
          : amountValid
            ? tr("withdrawForm.submitButton", { amount: fmtCoins(amt) })
            : tr("withdrawForm.submitButtonEmpty")}
      </Button>
    </div>
  );
}

function prettyError(
  code: string | undefined,
  tr: (k: string, vars?: Record<string, string | number>) => string,
): string {
  switch (code) {
    case "insufficient_coins":
      return tr("withdrawForm.errInsufficientCoins");
    case "email_not_verified":
      return tr("withdrawForm.errEmailNotVerified");
    case "rate_limited":
      return tr("withdrawForm.errRateLimited");
    case "forbidden":
      return tr("withdrawForm.errForbidden");
    case "invalid_input":
      return tr("withdrawForm.errInvalidInput");
    default:
      return tr("withdrawForm.errGeneric");
  }
}

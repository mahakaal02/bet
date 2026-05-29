"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toaster";
import { cn, fmtCoins } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/client";

interface Props {
  available: number;
  min: number;
}

type Method = "UPI" | "BANK" | "CRYPTO";

const CRYPTO_NETWORKS = [
  "USDT-TRC20",
  "USDT-ERC20",
  "USDT-BEP20",
  "USDC-ERC20",
  "BTC",
  "ETH",
] as const;

const SWIFT_RE = /^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/;
const IBAN_RE = /^[A-Za-z0-9 ]{4,40}$/;
const WALLET_RE = /^[A-Za-z0-9:_.\-]{20,120}$/;

/**
 * Withdrawal form. Three payout methods, switched via tab:
 *   - UPI    : India UPI id (name@bank)
 *   - BANK   : GLOBAL transfer — beneficiary, bank name, country,
 *              SWIFT/BIC, account number / IBAN
 *   - CRYPTO : network/asset + destination wallet address
 *
 * Client validation mirrors the server-side Zod; the server is the
 * authority. Fully localized via `withdrawForm.*` keys.
 */
export function WithdrawForm({ available, min }: Props) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("UPI");
  const [amount, setAmount] = useState<string>(String(min));
  // UPI
  const [upiId, setUpiId] = useState("");
  // Global bank
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankCountry, setBankCountry] = useState("");
  const [swiftBic, setSwiftBic] = useState("");
  const [accountIban, setAccountIban] = useState("");
  // Crypto
  const [network, setNetwork] = useState<(typeof CRYPTO_NETWORKS)[number]>("USDT-TRC20");
  const [walletAddress, setWalletAddress] = useState("");

  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const { t: tr, locale } = useTranslation();

  const amt = Number(amount);
  const amountValid =
    Number.isFinite(amt) && Number.isInteger(amt) && amt >= min && amt <= available;

  const methodValid =
    method === "UPI"
      ? /^[\w.\-]{2,256}@[\w]{2,64}$/.test(upiId)
      : method === "BANK"
        ? beneficiaryName.trim().length >= 2 &&
          bankName.trim().length >= 2 &&
          bankCountry.trim().length >= 2 &&
          SWIFT_RE.test(swiftBic.trim()) &&
          IBAN_RE.test(accountIban.trim())
        : WALLET_RE.test(walletAddress.trim());

  const valid = amountValid && methodValid;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      const body =
        method === "UPI"
          ? { payoutMethod: "UPI", amountCoins: amt, upiId: upiId.trim() }
          : method === "BANK"
            ? {
                payoutMethod: "BANK",
                amountCoins: amt,
                beneficiaryName: beneficiaryName.trim(),
                bankName: bankName.trim(),
                bankCountry: bankCountry.trim(),
                swiftBic: swiftBic.trim().toUpperCase(),
                accountIban: accountIban.trim().toUpperCase(),
              }
            : {
                payoutMethod: "CRYPTO",
                amountCoins: amt,
                network,
                walletAddress: walletAddress.trim(),
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
      setUpiId("");
      setBeneficiaryName("");
      setBankName("");
      setBankCountry("");
      setSwiftBic("");
      setAccountIban("");
      setWalletAddress("");
      setAmount(String(min));
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const labelCls =
    "mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500";

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["UPI", "BANK", "CRYPTO"] as Method[]).map((m) => (
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
            {tr(
              m === "UPI"
                ? "withdrawForm.methodUpi"
                : m === "BANK"
                  ? "withdrawForm.methodBank"
                  : "withdrawForm.methodCrypto",
            )}
          </button>
        ))}
      </div>

      <div>
        <label className={labelCls}>{tr("withdrawForm.amountLabel")}</label>
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
            {tr("withdrawForm.amountMinMax", { min: fmtCoins(min, locale), max: fmtCoins(available, locale) })}
          </span>
          {amountValid ? (
            <span className="text-emerald-300">
              {tr("withdrawForm.amountPayout", { amount: fmtCoins(amt, locale) })}
            </span>
          ) : (
            <span className="text-rose-300">
              {amt > available
                ? tr("withdrawForm.amountExceeds")
                : amt < min
                  ? tr("withdrawForm.amountMin", { min: fmtCoins(min, locale) })
                  : tr("withdrawForm.amountInteger")}
            </span>
          )}
        </div>
      </div>

      {method === "UPI" && (
        <div>
          <label className={labelCls}>{tr("withdrawForm.upiLabel")}</label>
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
      )}

      {method === "BANK" && (
        <>
          <div>
            <label className={labelCls}>{tr("withdrawForm.beneficiaryLabel")}</label>
            <Input value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} maxLength={120} disabled={busy} />
          </div>
          <div>
            <label className={labelCls}>{tr("withdrawForm.bankNameLabel")}</label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder={tr("withdrawForm.bankNamePlaceholder")} maxLength={120} disabled={busy} />
          </div>
          <div>
            <label className={labelCls}>{tr("withdrawForm.bankCountryLabel")}</label>
            <Input value={bankCountry} onChange={(e) => setBankCountry(e.target.value)} placeholder={tr("withdrawForm.bankCountryPlaceholder")} maxLength={80} disabled={busy} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{tr("withdrawForm.swiftLabel")}</label>
              <Input
                value={swiftBic}
                onChange={(e) => setSwiftBic(e.target.value.toUpperCase())}
                placeholder={tr("withdrawForm.swiftPlaceholder")}
                maxLength={11}
                disabled={busy}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div>
              <label className={labelCls}>{tr("withdrawForm.ibanLabel")}</label>
              <Input
                value={accountIban}
                onChange={(e) => setAccountIban(e.target.value.toUpperCase())}
                placeholder={tr("withdrawForm.ibanPlaceholder")}
                maxLength={40}
                disabled={busy}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>
        </>
      )}

      {method === "CRYPTO" && (
        <>
          <div>
            <label className={labelCls}>{tr("withdrawForm.cryptoNetworkLabel")}</label>
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value as (typeof CRYPTO_NETWORKS)[number])}
              disabled={busy}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
            >
              {CRYPTO_NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>{tr("withdrawForm.cryptoAddressLabel")}</label>
            <Input
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value.trim())}
              placeholder={tr("withdrawForm.cryptoAddressPlaceholder")}
              maxLength={120}
              disabled={busy}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {walletAddress.length > 0 && !WALLET_RE.test(walletAddress.trim()) && (
              <div className="mt-1 text-[11px] text-rose-300">
                {tr("withdrawForm.errInvalidWallet")}
              </div>
            )}
          </div>
        </>
      )}

      <Button onClick={submit} disabled={!valid || busy} className="w-full">
        {busy
          ? tr("withdrawForm.submitting")
          : amountValid
            ? tr("withdrawForm.submitButton", { amount: fmtCoins(amt, locale) })
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

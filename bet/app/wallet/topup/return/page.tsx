import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fmtCoins } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * /wallet/topup/return  (PR-BET-NOWPAYMENTS)
 *
 * Landing page for users coming back from the NOWPayments hosted
 * checkout. Reads `?order=<id>&result=<success|cancel>` from the URL
 * and renders the right copy.
 *
 * Crucially this page DOES NOT credit the wallet — that's the IPN
 * webhook's job. We just show the user the current state of their
 * order (which may still be "waiting confirmations" depending on
 * which coin they paid with).
 *
 * Why a separate page vs auto-redirect: blockchain confirmations
 * take 1-30+ minutes depending on coin. Slamming the user back to
 * /wallet would show their balance unchanged and confuse them. This
 * page sets expectations clearly.
 */
export default async function ReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; result?: string }>;
}) {
  const me = await getAuthedUser();
  if (!me) redirect("/login?next=/wallet");
  const sp = await searchParams;

  if (!sp.order) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <Card className="p-6 text-center">
          <h1 className="text-xl font-bold text-slate-100">Missing order id</h1>
          <p className="mt-2 text-sm text-slate-400">
            We couldn't tell which order this redirect was for. Open your
            wallet to see your recent top-ups.
          </p>
          <Link href="/wallet" className="mt-4 inline-block">
            <Button>Back to wallet</Button>
          </Link>
        </Card>
      </main>
    );
  }

  const order = await db.cryptoPaymentOrder.findUnique({
    where: { id: sp.order },
  });

  // Defensive: an order id from another user's URL shouldn't reveal
  // anything. Treat as missing.
  if (!order || order.userId !== me.id) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <Card className="p-6 text-center">
          <h1 className="text-xl font-bold text-slate-100">Order not found</h1>
          <p className="mt-2 text-sm text-slate-400">
            That order isn't on your account. If you just paid and think
            this is wrong, give it a few minutes for the network to
            confirm, then check your wallet.
          </p>
          <Link href="/wallet" className="mt-4 inline-block">
            <Button>Back to wallet</Button>
          </Link>
        </Card>
      </main>
    );
  }

  if (sp.result === "cancel" || order.status === "FAILED" || order.status === "EXPIRED") {
    return (
      <main className="mx-auto max-w-xl px-4 py-12">
        <Card className="p-6">
          <h1 className="text-xl font-bold text-slate-100">Top-up cancelled</h1>
          <p className="mt-2 text-sm text-slate-400">
            You didn't complete the payment for{" "}
            <span className="font-mono text-slate-200">
              {fmtCoins(order.coins)} coins (₹{order.amountInr})
            </span>
            . Nothing was charged. You can try again any time.
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/wallet">
              <Button>Back to wallet</Button>
            </Link>
          </div>
        </Card>
      </main>
    );
  }

  // Success branch — but we may be in any of {WAITING, CONFIRMING,
  // CONFIRMED, SENDING, FINISHED, PARTIALLY_PAID}.
  const captured = !!order.capturedAt;
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Card className="p-6">
        <h1 className="text-xl font-bold text-slate-100">
          {captured ? "Top-up complete ✓" : "Top-up in progress…"}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          {captured ? (
            <>
              <span className="font-mono text-emerald-300">
                +{fmtCoins(order.coins)} coins
              </span>{" "}
              have landed in your wallet. Spend them across markets,
              auctions, and Aviator.
            </>
          ) : (
            <>
              We've received your payment and are waiting for the network
              to confirm. Most coins finalise within a few minutes (some
              take longer). Your wallet will update automatically — you
              don't need to keep this page open.
            </>
          )}
        </p>
        <dl className="mt-4 space-y-1 text-xs text-slate-400">
          <div className="flex justify-between">
            <dt>Coins</dt>
            <dd className="font-mono text-slate-300">{fmtCoins(order.coins)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>INR value</dt>
            <dd className="font-mono text-slate-300">₹{order.amountInr}</dd>
          </div>
          {order.payCurrency && order.payAmount && (
            <div className="flex justify-between">
              <dt>Paid</dt>
              <dd className="font-mono text-slate-300">
                {order.payAmount} {order.payCurrency.toUpperCase()}
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>Status</dt>
            <dd className="font-mono text-slate-300">{order.status}</dd>
          </div>
        </dl>
        <Link href="/wallet" className="mt-4 inline-block">
          <Button>Back to wallet</Button>
        </Link>
      </Card>
    </main>
  );
}

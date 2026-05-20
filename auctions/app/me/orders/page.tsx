import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const metadata = { title: "My orders · Kalki Auctions" };

type OrderStatus =
  | "PENDING_ADDRESS"
  | "AWAITING_FULFILLMENT"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "DISPUTED"
  | "CANCELLED";

interface OrderListItem {
  id: string;
  status: OrderStatus;
  auctionTitle: string;
  retailPrice: number;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  disputedAt: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<OrderStatus, { label: string; tone: "neutral" | "warn" | "ok" | "danger" }> = {
  PENDING_ADDRESS:      { label: "Pick a shipping address",  tone: "warn" },
  AWAITING_FULFILLMENT: { label: "Awaiting fulfilment",      tone: "neutral" },
  IN_TRANSIT:           { label: "In transit",               tone: "neutral" },
  DELIVERED:            { label: "Delivered",                tone: "ok" },
  DISPUTED:             { label: "Disputed",                 tone: "danger" },
  CANCELLED:            { label: "Cancelled",                tone: "danger" },
};

/**
 * Orders list. Each row links to /me/orders/[id] for the detail
 * view + actions (set address, open dispute). Tracking link is
 * surfaced inline when available.
 */
export default async function MyOrdersPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/orders");

  let items: OrderListItem[];
  try {
    items = await backend.authed(token).get<OrderListItem[]>("/me/orders");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/orders");
    throw err;
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          ← Account
        </Link>
        <h1 className="mt-3 mb-1 text-2xl font-black">My orders</h1>
        <p className="mb-6 text-sm text-slate-400">
          Items you've won. Track shipping, open a dispute, set a delivery address.
        </p>

        {items.length === 0 && (
          <Card>
            <p className="text-sm text-slate-300">
              No orders yet. Win an auction and one will show up here.
            </p>
          </Card>
        )}

        <ul className="space-y-3">
          {items.map((o) => {
            const meta = STATUS_LABEL[o.status];
            return (
              <li key={o.id}>
                <Link
                  href={`/me/orders/${o.id}`}
                  className="block rounded-lg border border-slate-700 bg-slate-900/60 p-4 hover:border-cyan-500/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{o.auctionTitle}</div>
                      <div className="text-[11px] text-slate-500">
                        Won {new Date(o.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                  </div>
                  {o.trackingUrl && (
                    <p className="mt-2 text-xs text-slate-300">
                      Tracking:{" "}
                      <a
                        href={o.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-300 hover:underline"
                      >
                        {o.carrierName} · {o.trackingNumber}
                      </a>
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}

function StatusPill({ tone, children }: { tone: "neutral" | "warn" | "ok" | "danger"; children: React.ReactNode }) {
  const cls = {
    neutral: "border-slate-600 bg-slate-700/40 text-slate-200",
    warn:    "border-amber-500/40 bg-amber-500/10 text-amber-200",
    ok:      "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    danger:  "border-rose-500/40 bg-rose-500/10 text-rose-200",
  }[tone];
  return (
    <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

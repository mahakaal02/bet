import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kalki Hub" };

/**
 * Landing hub for the three Kalki products. Mirrors the Android
 * `HubScreen` exactly: three big tiles (Auctions, Aviator, Exchange),
 * one wallet chip at the top, and a sign-out button. From here the
 * user picks where to spend their coins.
 *
 *   - Aviator + Exchange live on their own origins (:3000, :3100). We
 *     append `?token=…` so the receiving app can SSO via its existing
 *     TokenBridge. This is the same handshake the Android WebView uses.
 *   - Auctions is the local route /auctions — no token hand-off needed
 *     since the cookie is already on this origin.
 *
 * Signed-out users get bounced to /login first.
 */
export default async function HubPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/");

  interface Me {
    username: string;
    email: string | null;
    coinBalance: number;
    isAdmin: boolean;
  }
  let me: Me | null = null;
  try {
    me = await backend.authed(token).get<Me>("/auth/me");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/");
    throw err;
  }

  const aviatorBase = process.env.NEXT_PUBLIC_AVIATOR_URL ?? "http://localhost:3000";
  const exchangeBase = process.env.NEXT_PUBLIC_EXCHANGE_URL ?? "http://localhost:3100";
  // SSO links carry the JWT so the destination's TokenBridge can sign
  // the user in. Local route stays clean — no need to leak the token
  // back to the URL bar.
  const aviatorHref = `${aviatorBase.replace(/\/$/, "")}/?token=${encodeURIComponent(token)}`;
  const exchangeHref = `${exchangeBase.replace(/\/$/, "")}/?token=${encodeURIComponent(token)}`;

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight">
            Hi <span className="text-cyan-300">@{me?.username}</span>
          </h1>
          <p className="text-sm text-slate-400">
            Pick a product to dive in. Your coins move with you — same
            wallet across all three.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ProductTile
            href="/auctions"
            title="Live Auctions"
            tagline="Lowest unique bid wins. Each bid costs coins from your wallet."
            tone="cyan"
            icon="🛒"
          />
          <ProductTile
            href={aviatorHref}
            title="Aviator"
            tagline="Cash out before the multiplier crashes."
            tone="orange"
            icon="✈️"
            external
          />
          <ProductTile
            href={exchangeHref}
            title="Kalki Exchange"
            tagline="Trade YES / NO shares on prediction markets."
            tone="emerald"
            icon="📈"
            external
          />
        </div>

        <Card className="mt-8 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-300">
            <span className="font-semibold text-amber-300">
              {(me?.coinBalance ?? 0).toLocaleString("en-IN")} coins
            </span>{" "}
            in your wallet.
          </div>
          <Link
            href={`${exchangeBase.replace(/\/$/, "")}/wallet?token=${encodeURIComponent(token)}`}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/15"
          >
            Top up wallet →
          </Link>
        </Card>
      </div>
    </main>
  );
}

function ProductTile({
  href,
  title,
  tagline,
  tone,
  icon,
  external,
}: {
  href: string;
  title: string;
  tagline: string;
  tone: "cyan" | "orange" | "emerald";
  icon: string;
  external?: boolean;
}) {
  const toneRing = {
    cyan: "from-cyan-500/20 via-cyan-500/0 hover:border-cyan-500/40",
    orange:
      "from-orange-500/20 via-orange-500/0 hover:border-orange-500/40",
    emerald:
      "from-emerald-500/20 via-emerald-500/0 hover:border-emerald-500/40",
  }[tone];
  const props = external
    ? { target: "_blank" as const, rel: "noopener noreferrer" }
    : {};
  // `h-full` on both Link and Card pins the tile to the grid row height
  // — without it, each tile sizes to its own content and the Aviator
  // tile (shortest tagline) renders shorter than its neighbours. The
  // `flex` + `mt-auto` on the footer pushes "Open →" to the bottom of
  // the equalised box so the row looks visually consistent.
  return (
    <Link href={href} {...props} className="block h-full">
      <Card
        className={`group relative flex h-full flex-col overflow-hidden bg-gradient-to-br ${toneRing} transition`}
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg border border-[var(--color-divider)] bg-slate-900/60 text-xl">
            {icon}
          </span>
          <div className="text-lg font-bold tracking-tight">{title}</div>
        </div>
        <p className="text-sm text-slate-400">{tagline}</p>
        <div className="mt-auto pt-4 text-xs font-semibold text-slate-500 transition group-hover:text-cyan-300">
          Open →
        </div>
      </Card>
    </Link>
  );
}

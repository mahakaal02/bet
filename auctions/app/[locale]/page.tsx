import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/",
    title: t("meta.homeTitle", locale),
    description: t("meta.homeDescription", locale),
    noindex: true, // Hub requires sign-in; keep out of the index.
  });
}

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
export default async function HubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (path: string) => localizedPath(path, locale);
  const token = await getSessionToken();
  if (!token) redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/"))}`);

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
  const adminBase = process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:4173";
  // SSO links carry the JWT so the destination's TokenBridge can sign
  // the user in. Local route stays clean — no need to leak the token
  // back to the URL bar.
  const tokenQs = `?token=${encodeURIComponent(token)}`;
  const isAdmin = !!me?.isAdmin;
  const auctionsHref = isAdmin
    ? `${adminBase.replace(/\/$/, "")}/auctions${tokenQs}`
    : lp("/auctions");
  const aviatorHref = isAdmin
    ? `${adminBase.replace(/\/$/, "")}/aviator/analytics${tokenQs}`
    : `${aviatorBase.replace(/\/$/, "")}/${tokenQs}`;
  const exchangeHref = isAdmin
    ? `${exchangeBase.replace(/\/$/, "")}/admin${tokenQs}`
    : `${exchangeBase.replace(/\/$/, "")}/${tokenQs}`;
  // Admin tiles all leave this origin, so they open externally just
  // like the user-facing Aviator/Exchange tiles do.
  const auctionsExternal = isAdmin;

  const balanceFormatted = (me?.coinBalance ?? 0).toLocaleString("en-IN");

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8">
          {/* Greeting is rendered as a single localized string with the
              user's handle interpolated in. The dictionary picks the
              opener ("Hi"/"Salut"/"Hola"/"Olá") and where the handle
              lands relative to it. We emit the literal `@username` in
              cyan and let the surrounding sentence wrap naturally. */}
          <h1 className="text-3xl font-black tracking-tight">
            {tr("hub.greeting", { handle: `@${me?.username ?? ""}` })}
            {isAdmin && (
              <span className="ml-3 align-middle rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-300">
                {tr("hub.adminBadge")}
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-400">
            {isAdmin
              ? tr("hub.pickProductAdmin")
              : tr("hub.pickProduct")}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ProductTile
            href={auctionsHref}
            title={tr("hub.auctionsTitle")}
            tagline={
              isAdmin
                ? tr("hub.auctionsAdminTagline")
                : tr("hub.auctionsTagline")
            }
            tone="cyan"
            icon="🛒"
            external={auctionsExternal}
            openLabel={tr("hub.open")}
          />
          <ProductTile
            href={aviatorHref}
            title={tr("hub.aviatorTitle")}
            tagline={
              isAdmin
                ? tr("hub.aviatorAdminTagline")
                : tr("hub.aviatorTagline")
            }
            tone="orange"
            icon="✈️"
            external
            openLabel={tr("hub.open")}
          />
          <ProductTile
            href={exchangeHref}
            title={tr("hub.exchangeTitle")}
            tagline={
              isAdmin
                ? tr("hub.exchangeAdminTagline")
                : tr("hub.exchangeTagline")
            }
            tone="emerald"
            icon="📈"
            external
            openLabel={tr("hub.open")}
          />
        </div>

        <Card className="mt-8 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-300">
            <span className="font-semibold text-amber-300">
              {tr("hub.coinsInWallet", { coins: balanceFormatted })}
            </span>
          </div>
          <Link
            href={`${exchangeBase.replace(/\/$/, "")}/wallet?token=${encodeURIComponent(token)}`}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/15"
          >
            {tr("hub.topUpWallet")}
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
  openLabel,
}: {
  href: string;
  title: string;
  tagline: string;
  tone: "cyan" | "orange" | "emerald";
  icon: string;
  external?: boolean;
  openLabel: string;
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
          {openLabel}
        </div>
      </Card>
    </Link>
  );
}

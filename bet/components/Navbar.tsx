"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Coins, Star, User, BarChart3, ShieldCheck, Home, Layers } from "lucide-react";
import useSWR from "swr";
import { fmtCoins } from "@/lib/utils";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Brand } from "@/components/Brand";
import { Avatar } from "@/components/Avatar";
import { HubLogoLink } from "@/components/HubLogoLink";
import { hubLoginUrl } from "@/lib/hub";
import {
  localizedPath,
  useTranslation,
} from "@/lib/i18n/client";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface MeResponse {
  user: { id: string; username: string; isAdmin: boolean; image: string | null };
  wallet: { balance: number };
}

export function Navbar() {
  const { data: session } = useSession();
  const { data } = useSWR<MeResponse>(
    session?.user ? "/api/me" : null,
    fetcher,
    { refreshInterval: 10_000, revalidateOnFocus: true }
  );

  const { t, locale } = useTranslation();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Logo always returns the user to the Kalki hub at :3200/.
            That's the canonical "pick a game" surface across the three
            products. We render a plain anchor (not Next's Link) because
            the hub lives on a different origin. */}
        <HubLogoLink>
          <Brand />
        </HubLogoLink>

        <nav className="hidden gap-1 md:flex">
          <NavLink
            href={localizedPath("/markets", locale)}
            icon={<Home className="h-4 w-4" />}
            label={t("nav.markets")}
          />
          <NavLink
            href={localizedPath("/events", locale)}
            icon={<Layers className="h-4 w-4" />}
            label={t("nav.events")}
          />
          <NavLink
            href={localizedPath("/portfolio", locale)}
            icon={<BarChart3 className="h-4 w-4" />}
            label={t("nav.portfolio")}
          />
          {data?.user && (
            <NavLink
              href={localizedPath("/watchlist", locale)}
              icon={<Star className="h-4 w-4" />}
              label={t("nav.watchlist")}
            />
          )}
          {data?.user.isAdmin && (
            <NavLink
              href="/admin"
              icon={<ShieldCheck className="h-4 w-4" />}
              label={t("nav.admin")}
            />
          )}
        </nav>

        <div className="flex items-center gap-2">
          {data?.wallet ? (
            <Link
              href={localizedPath("/wallet", locale)}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
              title={t("wallet.tapToTopup")}
            >
              <Coins className="h-4 w-4" />
              {fmtCoins(data.wallet.balance)}
            </Link>
          ) : session?.user ? (
            <span className="skeleton h-8 w-24" />
          ) : null}
          {session?.user ? (
            // Single account entry point — profile page hosts the
            // cross-app sign-out so we don't ship a one-app logout
            // button that leaves users stranded signed-in elsewhere.
            <>
              <NotificationsBell />
              <Link
                href={localizedPath("/profile", locale)}
                className="flex items-center gap-1.5 rounded-lg p-1 text-slate-300 hover:bg-slate-800"
                aria-label={t("nav.profile")}
                title={data?.user?.username ? `@${data.user.username}` : t("nav.profile")}
              >
                {data?.user.image ? (
                  <Avatar
                    src={data.user.image}
                    name={data.user.username}
                    size={28}
                  />
                ) : (
                  <User className="h-4 w-4" />
                )}
              </Link>
            </>
          ) : (
            // PR-SINGLE-LOGIN — sign-in routes to the canonical login
            // surface on the hub (auctions). Plain <a> with full origin
            // because the hub lives on a different port/origin and
            // Next.js's <Link> can't cross origins.
            <a
              href={hubLoginUrl()}
              className="rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-3 py-1.5 text-sm font-semibold text-slate-950"
            >
              {t("nav.signIn")}
            </a>
          )}
        </div>
      </div>

      {/* Mobile nav row */}
      <div className="flex justify-between border-t border-slate-800 px-4 py-1.5 md:hidden">
        <NavLink
          href={localizedPath("/markets", locale)}
          icon={<Home className="h-4 w-4" />}
          label={t("nav.markets")}
        />
        <NavLink
          href={localizedPath("/events", locale)}
          icon={<Layers className="h-4 w-4" />}
          label={t("nav.events")}
        />
        <NavLink
          href={localizedPath("/portfolio", locale)}
          icon={<BarChart3 className="h-4 w-4" />}
          label={t("nav.portfolio")}
        />
        {data?.user.isAdmin && (
          <NavLink
            href="/admin"
            icon={<ShieldCheck className="h-4 w-4" />}
            label={t("nav.admin")}
          />
        )}
      </div>
    </header>
  );
}

function NavLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

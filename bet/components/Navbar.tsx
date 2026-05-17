"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Coins, Star, User, Trophy, BarChart3, ShieldCheck, Home } from "lucide-react";
import useSWR from "swr";
import { fmtCoins } from "@/lib/utils";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Brand } from "@/components/Brand";
import { Avatar } from "@/components/Avatar";
import { HubLogoLink } from "@/components/HubLogoLink";

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
          <NavLink href="/markets" icon={<Home className="h-4 w-4" />} label="Markets" />
          <NavLink href="/portfolio" icon={<BarChart3 className="h-4 w-4" />} label="Portfolio" />
          {data?.user && (
            <NavLink href="/watchlist" icon={<Star className="h-4 w-4" />} label="Watchlist" />
          )}
          <NavLink href="/leaderboard" icon={<Trophy className="h-4 w-4" />} label="Leaderboard" />
          {data?.user.isAdmin && (
            <NavLink href="/admin" icon={<ShieldCheck className="h-4 w-4" />} label="Admin" />
          )}
        </nav>

        <div className="flex items-center gap-2">
          {data?.wallet ? (
            <Link
              href="/wallet"
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
              title="Wallet — tap to top up"
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
                href="/profile"
                className="flex items-center gap-1.5 rounded-lg p-1 text-slate-300 hover:bg-slate-800"
                aria-label="Profile"
                title={data?.user?.username ? `@${data.user.username}` : "Profile"}
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
            <Link
              href="/login"
              className="rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 px-3 py-1.5 text-sm font-semibold text-slate-950"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Mobile nav row */}
      <div className="flex justify-between border-t border-slate-800 px-4 py-1.5 md:hidden">
        <NavLink href="/markets" icon={<Home className="h-4 w-4" />} label="Markets" />
        <NavLink href="/portfolio" icon={<BarChart3 className="h-4 w-4" />} label="Portfolio" />
        <NavLink href="/leaderboard" icon={<Trophy className="h-4 w-4" />} label="Top" />
        {data?.user.isAdmin && (
          <NavLink href="/admin" icon={<ShieldCheck className="h-4 w-4" />} label="Admin" />
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile · Kalki" };

interface Me {
  id: string;
  email: string | null;
  username: string;
  isAdmin: boolean;
  coinBalance: number;
}

/**
 * One profile, three games. This page is the single source for
 * account-level actions across the Kalki product suite:
 *
 *   - View identity + the unified wallet balance.
 *   - Cross-app sign-out: clears the auctions cookie, then chains
 *     through Bet's logout (clears the NextAuth cookie) and Aviator's
 *     /logout page (clears localStorage), and finally lands at /login.
 *
 * Why centralise here: all three apps share one user identity (the
 * auctions backend). Letting users sign out from N places lets them
 * accidentally end up signed-in to two products while signed-out from
 * a third. One button, one consistent end state.
 */
export default async function ProfilePage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/profile");

  let me: Me;
  try {
    me = await backend.authed(token).get<Me>("/auth/me");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/profile");
    throw err;
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          ← Back to hub
        </Link>

        <div className="mt-4 mb-6 flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-full border border-slate-700 bg-slate-900/60 text-2xl font-black text-slate-100">
            {(me.username ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black tracking-tight text-slate-100">
              @{me.username}
            </h1>
            <p className="text-sm text-slate-400">
              {me.email ?? "no email on file"}
              {me.isAdmin && (
                <span className="ml-2 inline-block rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                  admin
                </span>
              )}
            </p>
          </div>
        </div>

        <Card className="mb-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Account
          </h2>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">Unified wallet</span>
            <span className="font-mono text-sm font-semibold text-amber-200">
              {me.coinBalance.toLocaleString("en-IN")} coins
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Same balance across Auctions, Aviator, and Kalki Exchange.
          </p>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Profile
          </h2>
          <Link
            href="/me/profile"
            className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-cyan-500/40 hover:bg-slate-800/80"
          >
            <span>
              <span className="block font-medium">Display name & avatar</span>
              <span className="text-[11px] text-slate-500">
                Your public face on Kalki — renamable once every 30 days
              </span>
            </span>
            <span aria-hidden className="text-slate-500">
              →
            </span>
          </Link>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Security
          </h2>
          <Link
            href="/me/2fa"
            className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-cyan-500/40 hover:bg-slate-800/80"
          >
            <span>
              <span className="block font-medium">
                Two-factor authentication
              </span>
              <span className="text-[11px] text-slate-500">
                Add an authenticator-app code to sign-in
              </span>
            </span>
            <span aria-hidden className="text-slate-500">
              →
            </span>
          </Link>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Responsible gambling
          </h2>
          <Link
            href="/me/rg"
            className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-cyan-500/40 hover:bg-slate-800/80"
          >
            <span>
              <span className="block font-medium">Limits, cool-down, self-exclude</span>
              <span className="text-[11px] text-slate-500">
                Set wager limits or take a break — help available at 1800-599-0019
              </span>
            </span>
            <span aria-hidden className="text-slate-500">
              →
            </span>
          </Link>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Daily reward
          </h2>
          <Link
            href="/me/daily"
            className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-cyan-500/40 hover:bg-slate-800/80"
          >
            <span>
              <span className="block font-medium">Daily login streak</span>
              <span className="text-[11px] text-slate-500">
                Bigger reward each day — bonuses on day 7, 14, and 30
              </span>
            </span>
            <span aria-hidden className="text-slate-500">
              →
            </span>
          </Link>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Account
          </h2>
          <Link
            href="/me/email"
            className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-cyan-500/40 hover:bg-slate-800/80"
          >
            <span>
              <span className="block font-medium">Change email</span>
              <span className="text-[11px] text-slate-500">
                Both current and new email must confirm before it applies
              </span>
            </span>
            <span aria-hidden className="text-slate-500">
              →
            </span>
          </Link>
        </Card>

        <Card className="mb-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Shipping
          </h2>
          <Link
            href="/me/addresses"
            className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-cyan-500/40 hover:bg-slate-800/80"
          >
            <span>
              <span className="block font-medium">Shipping addresses</span>
              <span className="text-[11px] text-slate-500">
                Where wins ship to — up to 10, one default
              </span>
            </span>
            <span aria-hidden className="text-slate-500">
              →
            </span>
          </Link>
        </Card>

        <Card>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Sign out
          </h2>
          <p className="mb-3 text-sm text-slate-300">
            Signs you out of all three Kalki games and clears your session
            on this device.
          </p>
          {/* Form posts to /api/auth/logout which clears the auctions
              cookie, then 303s through Bet's signout (clears NextAuth) and
              Aviator's logout page (clears localStorage), and finally
              redirects to /login. */}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/20"
            >
              Sign out of all games
            </button>
          </form>
        </Card>
      </div>
    </main>
  );
}

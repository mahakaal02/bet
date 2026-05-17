import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · Kalki Auctions" };

/**
 * Login page. We surface the demo accounts directly on the form so a
 * tester can click-to-fill without hunting through docs — this is a
 * dev convenience and is gated behind NODE_ENV !== production.
 *
 * Already signed in? Redirect to the listing.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const token = await getSessionToken();
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/";
  if (token) redirect(safeNext);

  const showDemo = process.env.NODE_ENV !== "production";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-black tracking-tight">
          <span className="text-cyan-300">Kalki</span>{" "}
          <span className="text-slate-300">Auctions</span>
        </h1>
        <p className="mb-6 text-sm text-slate-400">
          Sign in to browse live auctions and place bids in real time.
        </p>
        <LoginForm next={safeNext} demoVisible={showDemo} />
        {showDemo && (
          <p className="mt-4 text-center text-[11px] text-slate-500">
            Bids placed here debit your unified wallet on Bet — the same coin
            balance you see in the markets app.
          </p>
        )}
        <p className="mt-6 text-center text-[11px] text-slate-600">
          Don&apos;t have an account?{" "}
          <Link href="/" className="text-slate-400 hover:text-slate-200">
            Browse anonymously
          </Link>
        </p>
      </div>
    </main>
  );
}

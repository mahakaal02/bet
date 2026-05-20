import Link from "next/link";
import { ConfirmClient } from "./ConfirmClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm email change · Kalki Auctions" };

/**
 * Email-change confirmation page. The token comes in as `?token=…`
 * from one of the two confirmation emails. The actual POST happens
 * client-side so the token is sent in a body, not a URL query string
 * the server would log.
 *
 * No auth needed — the token itself is the credential.
 */
export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const hasToken = typeof token === "string" && token.length > 0;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-black tracking-tight">
          <span className="text-cyan-300">Confirm</span>{" "}
          <span className="text-slate-300">email change</span>
        </h1>
        {hasToken ? (
          <ConfirmClient token={token!} />
        ) : (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
            This page needs a confirmation token. Open the link in the
            email Kalki sent you.
          </div>
        )}
        <p className="mt-6 text-center text-[11px] text-slate-600">
          <Link
            href="/me/email"
            className="text-slate-400 hover:text-slate-200"
          >
            Back to email-change settings
          </Link>
        </p>
      </div>
    </main>
  );
}

import Link from "next/link";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set new password · Kalki Auctions" };

/**
 * Password-reset confirmation page. Expects `?token=…` from the
 * link emailed by `password_reset_v1`. The form posts to
 * `/api/auth/password-reset/confirm`; on success the user is told
 * to sign in (existing sessions were invalidated by the password
 * change).
 *
 * No token in the URL → render a friendly error pointing back to
 * the request form. Bad token surfaces a generic 400 from the API.
 */
export default async function ResetPasswordPage({
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
          <span className="text-cyan-300">Set</span>{" "}
          <span className="text-slate-300">new password</span>
        </h1>
        {hasToken ? (
          <>
            <p className="mb-6 text-sm text-slate-400">
              Pick a new password (at least 8 characters). All existing
              sign-ins will be ended once you save.
            </p>
            <ResetForm token={token!} />
          </>
        ) : (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
            <p>
              This page needs a reset token. Open the link in the
              email Kalki sent you, or{" "}
              <Link
                href="/auth/forgot"
                className="underline hover:opacity-80"
              >
                request a new reset link
              </Link>
              .
            </p>
          </div>
        )}
        <p className="mt-6 text-center text-[11px] text-slate-600">
          <Link
            href="/login"
            className="text-slate-400 hover:text-slate-200"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

import Link from "next/link";
import { ForgotForm } from "./ForgotForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forgot password · Kalki Auctions" };

/**
 * Password-reset request page. The form posts to
 * `/api/auth/password-reset/request` which forwards to the backend;
 * the backend always responds 200 regardless of whether the email is
 * registered, so an attacker can't enumerate accounts by probing.
 *
 * The success message is intentionally generic ("if this email is
 * registered we've sent a link") — never confirm or deny.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-black tracking-tight">
          <span className="text-cyan-300">Reset</span>{" "}
          <span className="text-slate-300">password</span>
        </h1>
        <p className="mb-6 text-sm text-slate-400">
          We&apos;ll email you a one-time link to set a new password.
          The link expires in 30 minutes.
        </p>
        <ForgotForm />
        <p className="mt-6 text-center text-[11px] text-slate-600">
          Remembered it?{" "}
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

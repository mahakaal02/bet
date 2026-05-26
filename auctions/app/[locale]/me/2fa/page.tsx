import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getSessionToken } from "@/lib/session";
import { TwoFactorClient } from "./TwoFactorClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-factor authentication · Kalki Auctions" };

/**
 * 2FA settings — enroll / disable / regenerate backup codes.
 * The actual state machine lives in `TwoFactorClient` because the
 * enrollment flow (request QR → wait for first code → verify) needs
 * client state. Server side only checks auth + renders the shell.
 */
export default async function TwoFactorPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/2fa");
  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-black">Two-factor authentication</h1>
        <p className="mb-6 text-sm text-slate-400">
          Adds a second step at sign-in. Even if your password leaks,
          an attacker can&apos;t get in without the code from your
          authenticator app.
        </p>
        <TwoFactorClient />
      </div>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { DeletionClient } from "./DeletionClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account deletion · Kalki Auctions" };

export type DeletionStatus =
  | { pending: false }
  | {
      pending: true;
      requestedAt: string;
      effectiveAt: string;
      purgedAt: string | null;
      reason: string | null;
      daysRemaining: number;
    };

export default async function AccountDeletionPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/delete");

  let status: DeletionStatus;
  try {
    status = await backend
      .authed(token)
      .get<DeletionStatus>("/me/account-deletion");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/delete");
    throw err;
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          ← Account
        </Link>
        <h1 className="mt-3 mb-1 text-2xl font-black">Close account</h1>
        <p className="mb-6 text-sm text-slate-400">
          Permanently close your Kalki account, or download a copy of
          everything we hold on you before you go.
        </p>
        <DeletionClient initial={status} />
      </div>
    </main>
  );
}

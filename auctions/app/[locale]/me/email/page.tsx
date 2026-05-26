import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { EmailChangeClient } from "./EmailChangeClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Change email · Kalki Auctions" };

export interface PendingChange {
  newEmail: string;
  oldConfirmed: boolean;
  newConfirmed: boolean;
  expiresAt: string;
  createdAt: string;
}

interface Me {
  email: string | null;
  username: string;
}

/**
 * Email-change settings. Server-renders the current account email +
 * any in-flight change request so the page shows the right state
 * (request form vs progress) on first paint. The interactive bits
 * (form, cancel, polling) live in the client component.
 */
export default async function EmailChangePage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/email");

  let me: Me;
  let pending: PendingChange | null = null;
  try {
    me = await backend.authed(token).get<Me>("/auth/me");
    const raw = await backend.authed(token).get<unknown>("/me/email-change");
    // Endpoint returns either the pending shape or `{ pending: null }`.
    pending = isPendingShape(raw) ? raw : null;
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/email");
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
          ← Profile
        </Link>

        <h1 className="mt-3 mb-1 text-2xl font-black">Change email</h1>
        <p className="mb-6 text-sm text-slate-400">
          Both your current email and the new email must confirm
          before the change takes effect. The links expire in 24
          hours.
        </p>

        <Card className="mb-4 space-y-2">
          <p className="text-xs uppercase tracking-wider text-slate-500">
            Current email
          </p>
          <p className="font-mono text-sm text-slate-100">
            {me.email ?? "(none — set one via support)"}
          </p>
        </Card>

        <EmailChangeClient initial={pending} />
      </div>
    </main>
  );
}

function isPendingShape(v: unknown): v is PendingChange {
  return (
    !!v &&
    typeof v === "object" &&
    "newEmail" in v &&
    typeof (v as Record<string, unknown>).newEmail === "string"
  );
}

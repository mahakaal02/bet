import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { SubmitTicketForm } from "./SubmitTicketForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support · Kalki" };

type TicketStatus =
  | "OPEN" | "AWAITING_USER" | "AWAITING_ADMIN" | "ESCALATED" | "RESOLVED" | "CLOSED";

interface TicketRow {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: TicketStatus;
  slaDueAt: string;
  firstResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABEL: Record<TicketStatus, { label: string; tone: "neutral" | "warn" | "ok" | "danger" }> = {
  OPEN:           { label: "Waiting for response", tone: "warn" },
  AWAITING_USER:  { label: "Your turn",            tone: "warn" },
  AWAITING_ADMIN: { label: "With support",         tone: "neutral" },
  ESCALATED:      { label: "Escalated",            tone: "neutral" },
  RESOLVED:       { label: "Resolved",             tone: "ok" },
  CLOSED:         { label: "Closed",               tone: "neutral" },
};

export default async function SupportPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/support");

  let listing: { items: TicketRow[]; nextCursor: string | null };
  try {
    listing = await backend.authed(token).get("/me/support");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/support");
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
        <h1 className="mt-3 mb-1 text-2xl font-black">Support</h1>
        <p className="mb-6 text-sm text-slate-400">
          Question, complaint, or anything stuck — we'll come back to you fast.
        </p>

        <SubmitTicketForm />

        {listing.items.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Your tickets
            </h2>
            <ul className="space-y-2">
              {listing.items.map((t) => {
                const meta = STATUS_LABEL[t.status];
                return (
                  <li key={t.id}>
                    <Link
                      href={`/me/support/${t.id}`}
                      className="block rounded-lg border border-slate-700 bg-slate-900/60 p-3 hover:border-cyan-500/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{t.subject}</div>
                          <div className="text-[11px] text-slate-500">
                            {t.category.replace(/_/g, " ").toLowerCase()} ·{" "}
                            {new Date(t.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function StatusPill({ tone, children }: { tone: "neutral" | "warn" | "ok" | "danger"; children: React.ReactNode }) {
  const cls = {
    neutral: "border-slate-600 bg-slate-700/40 text-slate-200",
    warn:    "border-amber-500/40 bg-amber-500/10 text-amber-200",
    ok:      "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    danger:  "border-rose-500/40 bg-rose-500/10 text-rose-200",
  }[tone];
  return (
    <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { TicketThreadClient } from "./TicketThreadClient";

export const dynamic = "force-dynamic";

interface MessageRow {
  id: string;
  body: string;
  isFromAdmin: boolean;
  createdAt: string;
}

interface TicketDetail {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  slaDueAt: string;
  firstResponseAt: string | null;
  messages: MessageRow[];
  createdAt: string;
  updatedAt: string;
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await getSessionToken();
  if (!token) redirect(`/login?next=/me/support/${id}`);

  let ticket: TicketDetail;
  try {
    ticket = await backend.authed(token).get(`/me/support/${id}`);
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect(`/login?next=/me/support/${id}`);
    throw err;
  }

  const closed = ticket.status === "CLOSED";

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/me/support"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          ← All tickets
        </Link>

        <Card className="mt-3 mb-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            {ticket.category.replace(/_/g, " ").toLowerCase()} · {ticket.priority.toLowerCase()}
          </div>
          <h1 className="text-xl font-black">{ticket.subject}</h1>
          <div className="text-[11px] text-slate-500">
            Status: {ticket.status.replace(/_/g, " ").toLowerCase()} · opened {new Date(ticket.createdAt).toLocaleString()}
          </div>
        </Card>

        <div className="space-y-3">
          {ticket.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border px-3 py-2 ${
                m.isFromAdmin
                  ? "border-cyan-500/30 bg-cyan-500/5"
                  : "border-slate-700 bg-slate-900/60"
              }`}
            >
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                {m.isFromAdmin ? "Kalki support" : "You"} · {new Date(m.createdAt).toLocaleString()}
              </div>
              <div className="whitespace-pre-wrap text-sm text-slate-200">{m.body}</div>
            </div>
          ))}
        </div>

        {!closed && (
          <div className="mt-4">
            <TicketThreadClient ticketId={ticket.id} />
          </div>
        )}
      </div>
    </main>
  );
}

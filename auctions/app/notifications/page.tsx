import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Notifications · Kalki" };

/**
 * Notifications screen — placeholder for now. Kept as a real route
 * (rather than a no-op bell icon) so the navbar icon has a destination
 * and we don't surprise users with dead clicks. Real notifications
 * will land here when we wire FCM / SSE through the backend.
 */
export default function NotificationsPage() {
  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-2xl font-black tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-slate-400">
          Auction reminders, bid status changes, and winning alerts will land
          here.
        </p>

        <Card className="mt-6 flex flex-col items-center gap-3 py-12 text-center">
          {/* Inline bell glyph — same shape as the navbar icon. */}
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="text-slate-600"
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          <p className="text-sm text-slate-400">You&apos;re all caught up.</p>
          <p className="text-[11px] text-slate-500">
            We&apos;ll send you a ping when an auction you&apos;re bidding on
            is about to close.
          </p>
        </Card>
      </div>
    </main>
  );
}

'use client';

import Navbar from '@/components/Navbar';

/**
 * Notifications placeholder. The bell icon in the navbar links here so
 * the click has a destination; real cashout / crash alerts will land
 * here once we wire FCM / SSE through the backend.
 */
export default function NotificationsPage() {
  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-6 py-6">
        <h1 className="text-2xl font-black tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Round crashes, cashout confirmations, and seed rotations will land
          here.
        </p>
        <div className="glass mt-6 rounded-2xl p-8 text-center">
          <p className="text-sm text-text-secondary">You&apos;re all caught up.</p>
        </div>
      </div>
    </main>
  );
}

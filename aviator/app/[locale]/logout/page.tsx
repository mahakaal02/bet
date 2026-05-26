'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { clearAuth } from '@/lib/auth';
import { useTranslation } from '@/lib/i18n/client';

/**
 * Cross-app sign-out hop for Aviator. Aviator stores its session in
 * `localStorage` (see `lib/auth.ts`), which can't be cleared by a
 * server-side route handler — only client JS on the same origin can
 * touch it.
 *
 * This page mounts, calls `clearAuth()` to wipe the localStorage keys,
 * then follows the `?next=` query to whatever the upstream chained
 * sign-out endpoint asked for (typically the auctions /login page).
 *
 * Safe-redirect note: only http(s) URLs are honoured. Any other
 * scheme (`javascript:`, `data:`) is rejected and we send the user
 * back to `/` instead.
 */
function LogoutInner() {
  const params = useSearchParams();
  const { t } = useTranslation();

  useEffect(() => {
    clearAuth();
    const next = params.get('next');
    let target = '/';
    if (next) {
      try {
        const url = new URL(next);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          target = url.toString();
        }
      } catch {
        /* fall through to '/' */
      }
    }
    // Replace so back-button doesn't bounce them into a re-logout loop.
    window.location.replace(target);
  }, [params]);

  return (
    <main className="min-h-screen flex items-center justify-center text-text-secondary">
      <p className="text-sm">{t('logout.signingOut')}</p>
    </main>
  );
}

export default function AviatorLogoutPage() {
  return (
    <Suspense fallback={null}>
      <LogoutInner />
    </Suspense>
  );
}

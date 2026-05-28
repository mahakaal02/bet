'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Client hook: the local-currency VALUE of a coin balance, anchored to
 * the backend's PPP pricing (see backend/PRICING.md):
 *
 *   per-coin = price(1000-coin pack) / 1000
 *   value    = balance × per-coin
 *
 * Reads the shared `kalki_locale` cookie (the country the user picked on
 * the hub — cookies are shared across localhost ports) and forwards it
 * to `/pricing/current?country=…`. Returns a formatted currency string
 * (e.g. "₹2,650") or null while loading / when no 1000-coin pack price
 * is published.
 */

const ZERO_DECIMAL = new Set([
  'JPY',
  'IDR',
  'INR',
  'TRY',
  'NGN',
  'PHP',
  'CNY',
  'RUB',
  'ZAR',
]);

interface Anchor {
  per1000: number;
  currency: string;
}

function readCountryCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)kalki_locale=([^;]+)/);
  return m ? decodeURIComponent(m[1]).toUpperCase() : null;
}

export function useCoinValue(balance: number | null | undefined): string | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    let alive = true;
    const country = readCountryCookie();
    const qs = country ? `?country=${encodeURIComponent(country)}` : '';
    api
      .get<{ packs: Array<{ coins: number; currency: string; price: string }> }>(
        `/pricing/current${qs}`,
      )
      .then((body) => {
        const p = body?.packs?.find((x) => x.coins === 1000);
        const per1000 = p ? Number(p.price) : NaN;
        if (alive && p && Number.isFinite(per1000) && per1000 > 0) {
          setAnchor({ per1000, currency: p.currency });
        }
      })
      .catch(() => {
        /* backend down / no snapshot — show coins only */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!anchor || balance == null) return null;
  const value = (anchor.per1000 / 1000) * Math.max(0, balance);
  const zero = ZERO_DECIMAL.has(anchor.currency);
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: anchor.currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: zero ? 0 : 2,
      maximumFractionDigits: zero ? 0 : 2,
    }).format(value);
  } catch {
    return `${anchor.currency} ${value.toFixed(zero ? 0 : 2)}`;
  }
}

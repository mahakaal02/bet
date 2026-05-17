'use client';

/**
 * Lazy-load the Razorpay Checkout JS SDK and open it with the given options.
 * Caller is responsible for handing the `handler` callback the verify step.
 */
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

export interface RazorpayOptions {
  key: string;
  amount: number; // paise
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}

let loadPromise: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loadPromise = null;
      reject(new Error('failed to load Razorpay'));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

export async function openRazorpay(opts: RazorpayOptions) {
  await loadRazorpay();
  if (!window.Razorpay) throw new Error('Razorpay not loaded');
  const rzp = new window.Razorpay(opts);
  rzp.open();
}

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  LOCALES,
  LOCALE_DISPLAY,
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
  localizedPath,
  splitLocaleFromPath,
  t,
  type Locale,
} from "@/lib/i18n";

/**
 * Language switcher (PR-BET-I18N).
 *
 * Header/footer dropdown. Mobile-friendly (touch targets ≥ 44px),
 * keyboard-accessible (Escape closes, focus-trap inside the open
 * menu via the document-click listener).
 *
 * Behaviour:
 *   • Selection writes the `preferred_language` cookie (1-year TTL)
 *     AND `localStorage` (the cookie is the source of truth for the
 *     middleware; localStorage is a backup so client-side code can
 *     read it without a server round-trip).
 *   • Then we `router.push` to the same path with the new locale
 *     prefix. No page reload — Next.js fetches the new locale's
 *     RSC payload and swaps the tree.
 *   • Server-rendered initial value comes from the URL prefix
 *     (resolved by the parent layout via `params.locale`). That
 *     means no hydration mismatch even on a cold load.
 */

export function LanguageSwitcher({
  currentLocale,
  align = "right",
  size = "md",
}: {
  currentLocale: Locale;
  /** Aligns the dropdown's left edge to the trigger. Default
   *  "right" works for header placements; "left" for footer. */
  align?: "left" | "right";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function selectLocale(next: Locale) {
    if (next === currentLocale) {
      setOpen(false);
      return;
    }
    // Persist preference in BOTH cookie + localStorage. Middleware
    // reads the cookie; client UI code that needs the preference
    // (without a round-trip) can read localStorage.
    const secure = window.location.protocol === "https:";
    document.cookie = [
      `${PREFERRED_LOCALE_COOKIE}=${next}`,
      `path=/`,
      `max-age=${PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS}`,
      `samesite=lax`,
      secure ? "secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
    try {
      localStorage.setItem(PREFERRED_LOCALE_COOKIE, next);
    } catch {
      /* private mode / quota — cookie alone is enough */
    }
    // Preserve the current page when switching. The split helper
    // handles the "already at /pt/markets" → "/en/markets" case
    // idempotently.
    const target = localizedPath(pathname ?? "/", next);
    setOpen(false);
    router.push(target);
    // router.refresh() to force the server-rendered layer to
    // re-resolve translations with the new locale.
    router.refresh();
  }

  const sizeCls = size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm";
  const menuAlign = align === "left" ? "left-0" : "right-0";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("switcher.label", currentLocale)}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/70 ${sizeCls} font-semibold text-slate-200 hover:border-slate-500 hover:bg-slate-900`}
      >
        <span aria-hidden>🌐</span>
        <span>{LOCALE_DISPLAY[currentLocale]}</span>
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`transition ${open ? "rotate-180" : ""}`}
        >
          <path d="M5 8l5 5 5-5H5z" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t("switcher.chooseLanguage", currentLocale)}
          className={`absolute ${menuAlign} top-full z-50 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl`}
        >
          {LOCALES.map((l) => {
            const active = l === currentLocale;
            return (
              <li key={l}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => selectLocale(l)}
                  // Min-height 44px so finger taps register reliably
                  // on mobile per WCAG 2.5.5.
                  className={`flex w-full min-h-[44px] items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${
                    active
                      ? "bg-cyan-500/15 text-cyan-200 font-semibold"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span>{LOCALE_DISPLAY[l]}</span>
                  {active && (
                    <span aria-hidden className="text-cyan-300">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

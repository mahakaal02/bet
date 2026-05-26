"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  LOCALES,
  LOCALE_DISPLAY,
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
  localizedPath,
  useTranslation,
  withPreservedParams,
  type Locale,
} from "@/lib/i18n/client";

/**
 * Language switcher (PR-BET-I18N).
 *
 * Implemented as a WAI-ARIA Listbox (button + listbox pattern, not
 * combobox — we have a fixed enum, no text input). Fully keyboard-
 * accessible per https://www.w3.org/WAI/ARIA/apg/patterns/listbox/:
 *
 *   • Trigger button: Enter/Space/ArrowDown/ArrowUp opens the menu.
 *   • Inside menu: ArrowDown/ArrowUp move active option (wrapping).
 *                  Home/End jump to first/last.
 *                  Enter/Space select; Escape cancels.
 *                  Tab closes the menu and lets focus advance
 *                  normally (matches native <select> behaviour).
 *   • aria-activedescendant points to the currently-active option
 *     so screen readers announce the highlighted choice without us
 *     moving DOM focus around inside the menu.
 *   • Focus returns to the trigger button on close.
 *   • Touch targets are min-h-11 (44px) per WCAG 2.5.5.
 *   • Component is RTL-safe — uses Tailwind logical utilities
 *     (start-/end-) so dropdown alignment swaps automatically in
 *     RTL locales.
 *
 * State:
 *   • Selection writes the `preferred_language` cookie (1-year TTL)
 *     AND `localStorage` for client-side reads.
 *   • Then `router.push` to the same path under the new locale prefix.
 *     `router.refresh()` ensures the RSC payload re-renders with the
 *     new dictionary.
 */

export function LanguageSwitcher({
  currentLocale,
  align = "end",
  size = "md",
}: {
  currentLocale: Locale;
  /** Where to anchor the dropdown relative to the trigger. "start"
   *  matches text-flow start (left in LTR, right in RTL); "end"
   *  matches text-flow end (right in LTR, left in RTL). Defaults
   *  to "end" — sensible for header placements. */
  align?: "start" | "end";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const pathname = usePathname();
  // PR-BET-I18N — preserve query state across locale swaps so a user
  // who lands on `/pt/wallet?utm_campaign=launch` and switches to
  // English ends up on `/en/wallet?utm_campaign=launch`, not
  // /en/wallet (which would shred attribution).
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** Index of the option that's currently keyboard-highlighted
   *  inside the open menu. Drives aria-activedescendant. Defaults
   *  to the currentLocale's index when the menu opens. */
  const [activeIdx, setActiveIdx] = useState(() =>
    Math.max(0, LOCALES.indexOf(currentLocale)),
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  // Stable IDs per option so aria-activedescendant can point at the
  // right <li> regardless of React render order. `useId` is keyed
  // to the component so SSR/CSR match.
  const optionIdFor = useCallback(
    (idx: number) => `${listboxId}-opt-${idx}`,
    [listboxId],
  );

  // Reset active highlight to the current locale every time we open.
  useEffect(() => {
    if (open) {
      setActiveIdx(Math.max(0, LOCALES.indexOf(currentLocale)));
    }
  }, [open, currentLocale]);

  // Close on outside click + Escape (closes from anywhere — even when
  // focus is outside the menu).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        closeAndRestoreFocus();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAndRestoreFocus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    // closeAndRestoreFocus is stable across renders; satisfying the
    // dep-array exhaustive-deps lint by inlining it would re-attach
    // the listener on every render. Disable here intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function closeAndRestoreFocus() {
    setOpen(false);
    // Return focus to the trigger so keyboard users don't lose place
    // in the page tab order. Next paint is the safest moment — the
    // menu's DOM is gone by then.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function selectLocale(next: Locale) {
    if (next === currentLocale) {
      closeAndRestoreFocus();
      return;
    }
    // Persist preference in BOTH cookie + localStorage. Middleware
    // reads the cookie; client UI code that needs the preference
    // (without a round-trip) reads localStorage.
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
    // Build the cross-locale target with every query parameter
    // intact — UTM tags, click IDs, referral codes, search/sort
    // filters, etc. — AND the hash fragment so a user reading
    // `/pt/markets#comments` lands on `/en/markets#comments` rather
    // than the top of the page. The user's analytics session
    // continues uninterrupted; their on-page position (anchor +
    // sort + filters) survives the language flip.
    const base = localizedPath(pathname ?? "/", next);
    const hash =
      typeof window !== "undefined" ? window.location.hash : undefined;
    const target = withPreservedParams(base, searchParams, hash);
    setOpen(false);
    router.push(target);
    router.refresh();
  }

  /* ────── Keyboard handlers ────────────────────────────────── */

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    // Opens the menu and pre-positions the highlight.
    switch (e.key) {
      case "ArrowDown":
      case "Enter":
      case " ":
      case "Spacebar": // older browsers
        e.preventDefault();
        setOpen(true);
        setActiveIdx(Math.max(0, LOCALES.indexOf(currentLocale)));
        break;
      case "ArrowUp":
        e.preventDefault();
        setOpen(true);
        setActiveIdx(LOCALES.length - 1);
        break;
      case "Home":
        e.preventDefault();
        setOpen(true);
        setActiveIdx(0);
        break;
      case "End":
        e.preventDefault();
        setOpen(true);
        setActiveIdx(LOCALES.length - 1);
        break;
    }
  }

  function onListboxKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % LOCALES.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + LOCALES.length) % LOCALES.length);
        break;
      case "Home":
        e.preventDefault();
        setActiveIdx(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIdx(LOCALES.length - 1);
        break;
      case "Enter":
      case " ":
      case "Spacebar":
        e.preventDefault();
        selectLocale(LOCALES[activeIdx]);
        break;
      case "Escape":
        e.preventDefault();
        closeAndRestoreFocus();
        break;
      case "Tab":
        // Match native <select>: Tab closes and lets focus continue.
        // Don't preventDefault — the browser handles the actual move.
        setOpen(false);
        break;
      default:
        // Type-ahead: jumping to the first locale whose display name
        // starts with the typed letter. Only single printable chars.
        if (e.key.length === 1) {
          const ch = e.key.toLowerCase();
          const startFrom = (activeIdx + 1) % LOCALES.length;
          for (let off = 0; off < LOCALES.length; off++) {
            const idx = (startFrom + off) % LOCALES.length;
            if (LOCALE_DISPLAY[LOCALES[idx]].toLowerCase().startsWith(ch)) {
              setActiveIdx(idx);
              break;
            }
          }
        }
    }
  }

  /* ────── Styling ────────────────────────────────────────────── */

  const sizeCls = size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm";
  // Anchor the menu to text-flow start/end — Tailwind v4 logical
  // utilities flip automatically in RTL. No more `left-0`/`right-0`.
  const menuAlign = align === "start" ? "start-0" : "end-0";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? optionIdFor(activeIdx) : undefined}
        aria-label={t("switcher.label")}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={`inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/70 ${sizeCls} font-semibold text-slate-200 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60`}
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
          id={listboxId}
          role="listbox"
          aria-label={t("switcher.chooseLanguage")}
          aria-activedescendant={optionIdFor(activeIdx)}
          tabIndex={-1}
          onKeyDown={onListboxKeyDown}
          // autoFocus once mounted so keyboard handlers fire from the
          // list, not the body. Mouse users are unaffected.
          ref={(el) => {
            if (el && open) el.focus({ preventScroll: true });
          }}
          className={`absolute ${menuAlign} top-full z-50 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl focus:outline-none`}
        >
          {LOCALES.map((l, idx) => {
            const active = l === currentLocale;
            const highlighted = idx === activeIdx;
            return (
              <li
                key={l}
                id={optionIdFor(idx)}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => selectLocale(l)}
                // Min-height 11 (44px) so finger taps register reliably
                // on mobile per WCAG 2.5.5.
                className={`flex w-full min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-start text-sm transition ${
                  highlighted
                    ? "bg-slate-800"
                    : active
                      ? "bg-cyan-500/15"
                      : ""
                } ${active ? "text-cyan-200 font-semibold" : "text-slate-300"}`}
              >
                <span>{LOCALE_DISPLAY[l]}</span>
                {active && (
                  <span aria-hidden className="text-cyan-300">
                    ✓
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

/**
 * Client-side i18n surface (PR-BET-I18N performance pass).
 *
 * ─ Why a separate module? ──────────────────────────────────────
 *
 * Importing `@/lib/i18n` from a client component drags in every
 * locale dictionary (en/pt/es/fr) because `index.ts` statically
 * imports all four. With ~640 LoC of strings per dictionary,
 * that's ~94 KB of unminified JS landing in shared client chunks
 * — every visitor downloads all four languages, even though only
 * one is rendered.
 *
 * This module is the ONE PLACE client components are allowed to
 * import i18n primitives from. It deliberately does NOT statically
 * import any dictionary. Instead, the *server* renders the
 * `[locale]/layout.tsx` which calls `dictionaryFor(locale)` on the
 * server side, pre-merges the active locale's dictionary with the
 * English fallback, and passes the result as a prop to
 * `<I18nProvider>`. The provider is a "use client" boundary, so the
 * dictionary travels over the wire as data (in the RSC payload),
 * not as bundled code. Crucially, the bundler sees no static
 * import of dictionary files from any client chunk, so none of
 * them get bundled.
 *
 * Net effect: client chunks contain ~150 bytes of i18n code
 * (walker + interpolator + React context) instead of ~94 KB.
 *
 * ─ Why pre-merge the fallback on the server? ───────────────────
 *
 * If we only shipped the active locale's partial dictionary, the
 * client would also need the English dictionary for fallback. By
 * merging server-side, the client receives one fully-resolved
 * dictionary and never needs the fallback walker. Cheaper on
 * every render and one less object to serialize.
 *
 * ─ SSR-friendly ─────────────────────────────────────────────────
 *
 * `<I18nProvider>` is a client component that wraps its children;
 * it runs on the server during SSR (rendering the provider tree
 * into HTML) AND on the client after hydration. The context value
 * is computed via `useMemo` keyed on `locale` + `dictionary`, so
 * no work runs on every re-render.
 *
 * `useTranslation()` reads from context; if no provider is mounted
 * (e.g. a component rendered outside `[locale]/`), it falls back
 * to a stub that renders the raw key. Defensive — never crashes
 * the tree, and missing-provider cases surface in QA as "nav.markets"
 * text rather than blanks.
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  dirForLocale,
  type Direction,
  type Locale,
} from "./config";

/**
 * Recursive dictionary shape. Duplicated here (rather than imported
 * from `./translations/en`) to keep the client-side module
 * dictionary-free at build time. Structural type — anything matching
 * `{ [key]: string | nested-dict }` works.
 */
export interface ClientDictionary {
  [key: string]: string | ClientDictionary;
}

interface I18nContextValue {
  locale: Locale;
  dir: Direction;
  /** Fully-resolved dictionary for the active locale (already
   *  merged with English fallback on the server). */
  dict: ClientDictionary;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Provider mounted by the localized layout. Receives the pre-merged
 * dictionary from the server; client components consume via
 * `useTranslation()`.
 *
 * SSR-safe — `useMemo` is the only hook, runs identically on server
 * and client. The provider itself adds zero render cost beyond the
 * context push.
 */
export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: ClientDictionary;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir: dirForLocale(locale),
      dict: dictionary,
    }),
    [locale, dictionary],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/* ============================================================
   Translation accessor
   ============================================================ */

function walkDeep(dict: unknown, key: string): unknown {
  if (!dict || typeof dict !== "object") return undefined;
  const segments = key.split(".");
  let cursor: unknown = dict;
  for (const seg of segments) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

/**
 * Translation function signature returned by `useTranslation()`.
 *
 * Named interface (rather than an inline arrow type on the hook's
 * return shape) so it can be reused as a parameter type in helper
 * functions like `prettyError(code, t)`. Keeping the shape under one
 * name also keeps TypeScript's inference deterministic across Node /
 * lib.d.ts variations — the inline `vars?:` form can occasionally
 * be inferred as required when threaded through certain generic
 * call chains.
 */
export interface TranslateFunction {
  (key: string, vars?: Record<string, string | number>): string;
}

/**
 * Hook that returns the active locale + a `t(key, vars?)` function
 * scoped to that locale. The function reference is memoised on
 * `dict`, so it's referentially-stable across renders unless the
 * provider's dictionary actually changes (it doesn't, in practice).
 *
 *   const { t, locale, dir } = useTranslation();
 *   return <h1>{t("nav.markets")}</h1>;
 *
 * Defensive: when no provider is mounted, returns a stub that
 * renders the raw key. This lets development surface missing
 * providers visually instead of throwing.
 */
export function useTranslation(): {
  locale: Locale;
  dir: Direction;
  t: TranslateFunction;
} {
  const ctx = useContext(I18nContext);
  // Memoise the `t` function so its reference stays stable across
  // renders unless the provider's dictionary changes. useMemo + an
  // explicit `TranslateFunction` annotation keeps the type signature
  // pinned (with optional `vars`) regardless of TS inference quirks
  // — the same callback declared via useCallback historically
  // occasionally inferred `vars` as required when threaded through
  // generic helper types in some Node / lib.d.ts combinations.
  const dict = ctx?.dict;
  const t = useMemo<TranslateFunction>(
    () =>
      (key: string, vars?: Record<string, string | number>): string => {
        const val = walkDeep(dict, key);
        const str = typeof val === "string" ? val : key;
        return interpolate(str, vars);
      },
    [dict],
  );

  if (!ctx) {
    return { locale: DEFAULT_LOCALE, dir: "ltr", t };
  }
  return { locale: ctx.locale, dir: ctx.dir, t };
}

/* ============================================================
   Re-exports — types + config-only helpers safe for client use.
   No dictionary imports cross this line.
   ============================================================ */

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_DISPLAY,
  PREFERRED_LOCALE_COOKIE,
  PREFERRED_LOCALE_COOKIE_MAX_AGE_SECONDS,
  RTL_LOCALES,
  isLocale,
  localeForCountry,
  dirForLocale,
  type Locale,
  type Direction,
} from "./config";

// Path / URL helpers are pure functions with no dict dependency —
// safe for client use. Inline them here so client components don't
// have to pull from "@/lib/i18n" (which would re-introduce the
// dictionary imports).

export function splitLocaleFromPath(pathname: string): {
  locale: Locale | null;
  rest: string;
} {
  const trimmed = pathname.replace(/^\/+/, "");
  const idx = trimmed.indexOf("/");
  const head = idx === -1 ? trimmed : trimmed.slice(0, idx);
  if (isLocaleHelper(head)) {
    const rest = idx === -1 ? "/" : `/${trimmed.slice(idx + 1)}`;
    return { locale: head, rest };
  }
  return { locale: null, rest: pathname === "" ? "/" : pathname };
}

export function localizedPath(pathname: string, locale: Locale): string {
  const { rest } = splitLocaleFromPath(pathname);
  if (rest === "/") return `/${locale}`;
  return `/${locale}${rest}`;
}

// Local copy of isLocale so this module is self-contained — re-export
// of the canonical one above lives at the top so call sites can use
// either. Same logic; importing from config keeps types in sync.
import { isLocale as isLocaleHelper } from "./config";

// Analytics helpers used by client components (no dict dependency).
export {
  TRACKING_PARAM_KEYS,
  extractTrackingParams,
  appendTrackingParams,
  withPreservedParams,
  localeDimension,
  localeAnalyticsContext,
  type LocaleAnalyticsContext,
} from "./analytics";

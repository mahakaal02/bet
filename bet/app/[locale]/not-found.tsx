import Link from "next/link";
import { headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

/**
 * Localized 404 (PR-BET-I18N).
 *
 * The root `app/not-found.tsx` continues to handle 404s that escape
 * the locale tree (extremely rare — the middleware enforces locale
 * prefixes). This variant fires when a path inside `/{locale}/...`
 * doesn't resolve, and so should render in the user's language with
 * a "back home" link that stays inside their locale tree.
 *
 * Locale resolution: we can't read `params` from a `not-found.tsx`
 * (Next.js doesn't pass them) so we sniff the locale from the
 * referer URL when present, falling back to the default. The result
 * is the user lands on a 404 page that matches the language of the
 * page they were trying to reach.
 */

export const dynamic = "force-dynamic";

export default async function LocaleNotFound() {
  const hdrs = await headers();
  const referer = hdrs.get("referer");
  let locale: Locale = DEFAULT_LOCALE;
  if (referer) {
    try {
      const path = new URL(referer).pathname;
      const seg = path.split("/").filter(Boolean)[0];
      if (isLocale(seg)) locale = seg;
    } catch {
      /* malformed referer — fall back to default */
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-3 text-6xl font-black tracking-tight text-slate-100">
        404
      </div>
      <h1 className="text-xl font-bold text-slate-100">
        {t("errors.notFound", locale)}
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        {t("errors.notFoundDescription", locale)}
      </p>
      <Link
        href={localizedPath("/", locale)}
        className="mt-6 inline-flex h-9 items-center rounded-lg bg-cyan-500 px-3.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
      >
        {t("errors.backHome", locale)}
      </Link>
    </main>
  );
}

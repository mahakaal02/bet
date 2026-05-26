import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/auth/reset",
    title: t("meta.resetTitle", locale),
    description: t("meta.resetDescription", locale),
  });
}

/**
 * Password-reset confirmation page. Expects `?token=…` from the
 * link emailed by `password_reset_v1`. The form posts to
 * `/api/auth/password-reset/confirm`; on success the user is told
 * to sign in (existing sessions were invalidated by the password
 * change).
 *
 * No token in the URL → render a friendly error pointing back to
 * the request form. Bad token surfaces a generic 400 from the API.
 */
export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string) => t(k, locale);
  const lp = (path: string) => localizedPath(path, locale);
  const { token } = await searchParams;
  const hasToken = typeof token === "string" && token.length > 0;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-black tracking-tight">
          {tr("auth.resetHeading")}
        </h1>
        {hasToken ? (
          <>
            <p className="mb-6 text-sm text-slate-400">
              {tr("auth.forgotSubtext")}
            </p>
            <ResetForm token={token!} />
          </>
        ) : (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
            <p>
              {tr("auth.invalidOrExpiredLink")}{" "}
              <Link
                href={lp("/auth/forgot")}
                className="underline hover:opacity-80"
              >
                {tr("auth.requestNewLink")}
              </Link>
            </p>
          </div>
        )}
        <p className="mt-6 text-center text-[11px] text-slate-600">
          <Link
            href={lp("/login")}
            className="text-slate-400 hover:text-slate-200"
          >
            {tr("auth.forgotBackToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}

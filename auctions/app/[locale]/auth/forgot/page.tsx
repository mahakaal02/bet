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
import { ForgotForm } from "./ForgotForm";

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
    path: "/auth/forgot",
    title: t("meta.forgotTitle", locale),
    description: t("meta.forgotDescription", locale),
  });
}

/**
 * Password-reset request page. The form posts to
 * `/api/auth/password-reset/request` which forwards to the backend;
 * the backend always responds 200 regardless of whether the email is
 * registered, so an attacker can't enumerate accounts by probing.
 *
 * The success message is intentionally generic ("if this email is
 * registered we've sent a link") — never confirm or deny.
 */
export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string) => t(k, locale);
  const lp = (path: string) => localizedPath(path, locale);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-black tracking-tight">
          {tr("auth.forgotHeading")}
        </h1>
        <p className="mb-6 text-sm text-slate-400">{tr("auth.forgotSubtext")}</p>
        <ForgotForm />
        <p className="mt-6 text-center text-[11px] text-slate-600">
          {tr("auth.forgotRememberedIt")}{" "}
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

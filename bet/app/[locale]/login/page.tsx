import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  t,
  type Locale,
} from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

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
    path: "/login",
    title: t("meta.loginTitle", locale),
    description: t("meta.loginDescription", locale),
  });
}

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

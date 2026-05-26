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
import { VerifyForm } from "./VerifyForm";

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
    path: "/verify",
    title: t("meta.verifyTitle", locale),
    description: t("meta.verifyDescription", locale),
    noindex: true,
  });
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  );
}

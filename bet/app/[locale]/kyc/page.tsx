import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { KycForm } from "./KycForm";
import {
  DEFAULT_LOCALE,
  alternatesFor,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const origin =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "http://localhost:3100";
  return {
    title: t("kyc.heading", locale),
    description: t("kyc.subtext", locale),
    alternates: {
      canonical: `${origin}/${locale}/kyc`,
      languages: alternatesFor(origin, "/kyc"),
    },
  };
}

/**
 * User-side KYC submission (PR-BET-ADMIN-FOLLOWUPS).
 *
 * Required-by-policy when the user wants to withdraw above the
 * configured threshold (see admin setting `kyc.required_threshold_coins`).
 * Voluntary otherwise — kept open so users can pre-verify before they
 * hit a withdrawal limit.
 *
 * Flow:
 *   PENDING  → admin reviews → APPROVED | REJECTED | REQUEST_MORE
 *   REJECTED   user sees rejection code + can resubmit
 *   REQUEST_MORE  user uploads additional doc(s), resubmits
 *
 * Document handling: this page collects PAN, Aadhaar, and a selfie
 * as form-uploaded files; the POST endpoint writes them to S3 via
 * the existing `lib/kyc-storage.ts` (shipped from the auctions
 * stack — PR-INFRA-S3-1) and stores opaque S3 references in the
 * KycSubmission.documents JSON. Bytes never live in the bet
 * filesystem; the admin reviewer fetches them through the same
 * KYCObjectStore on demand.
 */
export default async function KycPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);

  const me = await getAuthedUser();
  if (!me) redirect(localizedPath("/login?next=/kyc", locale));

  const submission = await db.kycSubmission.findUnique({
    where: { userId: me.id },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-black tracking-tight text-slate-100">
        {tr("kyc.heading")}
      </h1>
      <p className="mb-6 text-sm text-slate-400">{tr("kyc.subtext")}</p>

      {submission && (
        <Card className="mb-4 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {tr("kyc.statusLabel")}
          </div>
          <StatusBlock
            status={submission.status}
            rejectionCode={submission.rejectionCode}
            notes={submission.notes}
            tr={tr}
          />
        </Card>
      )}

      <Card className="p-4">
        <KycForm hasSubmission={!!submission} status={submission?.status ?? null} />
      </Card>
    </main>
  );
}

function StatusBlock({
  status,
  rejectionCode,
  notes,
  tr,
}: {
  status: string;
  rejectionCode: string | null;
  notes: string | null;
  tr: (k: string, vars?: Record<string, string | number>) => string;
}) {
  if (status === "APPROVED") {
    return (
      <div className="mt-1">
        <div className="text-base font-bold text-emerald-300">
          {tr("kyc.approved")}
        </div>
        <p className="mt-1 text-xs text-slate-400">{tr("kyc.approvedNote")}</p>
      </div>
    );
  }
  if (status === "REJECTED") {
    return (
      <div className="mt-1">
        <div className="text-base font-bold text-rose-300">
          {tr("kyc.rejected")}
        </div>
        {rejectionCode && (
          <p className="mt-0.5 text-xs uppercase tracking-wider text-rose-400">
            {tr("kyc.rejectionCodeLabel", { code: rejectionCode })}
          </p>
        )}
        {notes && <p className="mt-1 text-xs text-slate-400">{notes}</p>}
        <p className="mt-1 text-xs text-slate-400">{tr("kyc.resubmitNote")}</p>
      </div>
    );
  }
  if (status === "REQUEST_MORE") {
    return (
      <div className="mt-1">
        <div className="text-base font-bold text-amber-300">
          {tr("kyc.requestMore")}
        </div>
        {notes && <p className="mt-1 text-xs text-slate-400">{notes}</p>}
      </div>
    );
  }
  return (
    <div className="mt-1">
      <div className="text-base font-bold text-cyan-300">{tr("kyc.pending")}</div>
      <p className="mt-1 text-xs text-slate-400">{tr("kyc.pendingNote")}</p>
    </div>
  );
}

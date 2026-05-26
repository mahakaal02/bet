import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { KycForm } from "./KycForm";

export const dynamic = "force-dynamic";

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
export default async function KycPage() {
  const me = await getAuthedUser();
  if (!me) redirect("/login?next=/kyc");

  const submission = await db.kycSubmission.findUnique({
    where: { userId: me.id },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-black tracking-tight text-slate-100">
        Identity verification
      </h1>
      <p className="mb-6 text-sm text-slate-400">
        Required for withdrawals above the platform limit. Submitted
        documents are encrypted at rest and only visible to a single
        compliance reviewer.
      </p>

      {submission && (
        <Card className="mb-4 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Current status
          </div>
          <StatusBlock status={submission.status} rejectionCode={submission.rejectionCode} notes={submission.notes} />
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
}: {
  status: string;
  rejectionCode: string | null;
  notes: string | null;
}) {
  if (status === "APPROVED") {
    return (
      <div className="mt-1">
        <div className="text-base font-bold text-emerald-300">Approved ✓</div>
        <p className="mt-1 text-xs text-slate-400">
          Full withdrawal limits unlocked. No further action needed.
        </p>
      </div>
    );
  }
  if (status === "REJECTED") {
    return (
      <div className="mt-1">
        <div className="text-base font-bold text-rose-300">Rejected</div>
        {rejectionCode && (
          <p className="mt-0.5 text-xs uppercase tracking-wider text-rose-400">
            Code: {rejectionCode}
          </p>
        )}
        {notes && <p className="mt-1 text-xs text-slate-400">{notes}</p>}
        <p className="mt-1 text-xs text-slate-400">
          You can resubmit using the form below.
        </p>
      </div>
    );
  }
  if (status === "REQUEST_MORE") {
    return (
      <div className="mt-1">
        <div className="text-base font-bold text-amber-300">More documents requested</div>
        {notes && <p className="mt-1 text-xs text-slate-400">{notes}</p>}
      </div>
    );
  }
  return (
    <div className="mt-1">
      <div className="text-base font-bold text-cyan-300">Pending review</div>
      <p className="mt-1 text-xs text-slate-400">
        Typical turnaround is 1 business day. You'll get an in-app
        notification when the decision lands.
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { useTranslation } from "@/lib/i18n/client";

/**
 * KYC document upload form (PR-BET-ADMIN-FOLLOWUPS).
 *
 * Three files: PAN front, Aadhaar front + back, selfie. Submit posts
 * a multipart form to /api/me/kyc; server-side the bytes are streamed
 * to S3 via the existing KYC storage abstraction and only the opaque
 * S3 references land in the database.
 *
 * Resubmit path: when the user already has a REJECTED / REQUEST_MORE
 * submission, the form's submit button reads "Resubmit"; the
 * endpoint either updates the existing row or creates a new
 * submission depending on the prior status.
 */
export function KycForm({
  hasSubmission,
  status,
}: {
  hasSubmission: boolean;
  status: string | null;
}) {
  const { t: tr } = useTranslation();

  const [busy, setBusy] = useState(false);

  // If approved, no form — just confirmation copy.
  if (status === "APPROVED") {
    return (
      <p className="text-sm text-slate-400">{tr("kyc.approvedFormNote")}</p>
    );
  }

  // If already pending, allow withdrawing the submission (cancel) but
  // not silently overwriting it — that would let an attacker race the
  // reviewer.
  if (status === "PENDING") {
    return (
      <p className="text-sm text-slate-400">{tr("kyc.pendingFormNote")}</p>
    );
  }

  async function onSubmit(formData: FormData) {
    setBusy(true);
    try {
      const res = await fetch("/api/me/kyc", {
        method: "POST",
        body: formData,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      toast(tr("toast.submitted"), "ok");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(new FormData(e.currentTarget));
      }}
      className="space-y-4"
    >
      <FileField
        name="pan"
        label={tr("kyc.panLabel")}
        hint={tr("kyc.panHint")}
      />
      <FileField
        name="aadhaar"
        label={tr("kyc.aadhaarLabel")}
        hint={tr("kyc.aadhaarHint")}
      />
      <FileField
        name="selfie"
        label={tr("kyc.selfieLabel")}
        hint={tr("kyc.selfieHint")}
      />
      <Button type="submit" disabled={busy} className="w-full">
        {busy
          ? tr("kyc.uploadingButton")
          : hasSubmission
            ? tr("kyc.resubmitButton")
            : tr("kyc.submitButton")}
      </Button>
      <p className="text-[11px] text-slate-500">{tr("kyc.securityNote")}</p>
    </form>
  );
}

function FileField({
  name,
  label,
  hint,
}: {
  name: string;
  label: string;
  hint: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold text-slate-300">{label}</div>
      <input
        type="file"
        name={name}
        accept="image/*,application/pdf"
        required
        className="block w-full rounded-md border border-slate-800 bg-slate-950/60 text-sm text-slate-300 file:me-3 file:rounded-md file:border-0 file:bg-cyan-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950 hover:file:bg-cyan-400"
      />
      <div className="mt-1 text-[11px] text-slate-500">{hint}</div>
    </label>
  );
}

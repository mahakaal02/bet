"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";

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
  const [busy, setBusy] = useState(false);

  // If approved, no form — just confirmation copy.
  if (status === "APPROVED") {
    return (
      <p className="text-sm text-slate-400">
        Your identity is verified. No further documents needed at this
        time. If your name or address changes, contact support to refresh.
      </p>
    );
  }

  // If already pending, allow withdrawing the submission (cancel) but
  // not silently overwriting it — that would let an attacker race the
  // reviewer.
  if (status === "PENDING") {
    return (
      <p className="text-sm text-slate-400">
        Your documents are with the reviewer. You'll be notified when a
        decision lands. To replace a document, contact support.
      </p>
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
      toast("Submitted for review.", "ok");
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
        label="PAN card (front)"
        hint="Clear photo of the card. JPG/PNG/PDF up to 5 MB."
      />
      <FileField
        name="aadhaar"
        label="Aadhaar card (front + back)"
        hint="Mask the first 8 digits of the Aadhaar number if you prefer — the last 4 are sufficient for verification."
      />
      <FileField
        name="selfie"
        label="Selfie"
        hint="Face clearly visible, no sunglasses or hat. Used for face-match against PAN."
      />
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Uploading…" : hasSubmission ? "Resubmit" : "Submit for review"}
      </Button>
      <p className="text-[11px] text-slate-500">
        Documents are encrypted at rest using AES-256-GCM with the
        platform's KMS-wrapped data-encryption key. Only the assigned
        compliance reviewer can decrypt them, and access is logged in
        the admin audit trail.
      </p>
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
        className="block w-full rounded-md border border-slate-800 bg-slate-950/60 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950 hover:file:bg-cyan-400"
      />
      <div className="mt-1 text-[11px] text-slate-500">{hint}</div>
    </label>
  );
}

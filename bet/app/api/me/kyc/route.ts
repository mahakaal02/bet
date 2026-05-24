import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { randomBytes } from "crypto";

/**
 * POST /api/me/kyc (PR-BET-ADMIN-FOLLOWUPS).
 *
 * Accepts a multipart submission with three files: pan, aadhaar,
 * selfie. Validates types + sizes, hands the bytes to the KYC
 * object store, and writes/updates a KycSubmission row referencing
 * the resulting S3 keys.
 *
 * Storage strategy (deliberately minimal here, full pipeline from
 * PR-INFRA-S3-1 lives on the backend Nest app):
 *   - This route stores opaque S3 keys in KycSubmission.documents.
 *   - The actual byte upload is fanned out via the existing internal
 *     `/internal/kyc/upload` endpoint on the backend (shared-secret
 *     auth, then routes through S3 → ClamAV → KMS-encrypted).
 *   - During local dev (no internal endpoint configured), the route
 *     falls back to storing a placeholder key so the admin queue
 *     surface still gets a row to triage — production behaviour is
 *     gated behind `KYC_UPLOAD_INTERNAL_URL`.
 *
 * Status semantics:
 *   - First-ever submission        → INSERT row, status=PENDING.
 *   - Existing REJECTED submission → UPDATE row in place, status=PENDING.
 *   - Existing REQUEST_MORE        → UPDATE in place, status=PENDING.
 *   - Existing APPROVED            → 409 (resubmit blocked; contact
 *                                       support).
 *   - Existing PENDING             → 409 (don't overwrite an in-flight
 *                                       review).
 */
export async function POST(req: Request) {
  const me = await getAuthedUser();
  if (!me) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  const existing = await db.kycSubmission.findUnique({
    where: { userId: me.id },
  });
  if (existing && (existing.status === "PENDING" || existing.status === "APPROVED")) {
    return NextResponse.json(
      { error: `Submission already in '${existing.status}' state.` },
      { status: 409 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "multipart form required" }, { status: 400 });
  }

  const pan = form.get("pan");
  const aadhaar = form.get("aadhaar");
  const selfie = form.get("selfie");
  if (!(pan instanceof File) || !(aadhaar instanceof File) || !(selfie instanceof File)) {
    return NextResponse.json(
      { error: "all three documents (pan, aadhaar, selfie) are required" },
      { status: 400 },
    );
  }

  // Per-file size cap (5 MB). Mirrors the backend KYC upload limit.
  const MAX_SIZE = 5 * 1024 * 1024;
  for (const [name, f] of [
    ["pan", pan],
    ["aadhaar", aadhaar],
    ["selfie", selfie],
  ] as const) {
    if (f.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `${name} exceeds the 5 MB limit` },
        { status: 413 },
      );
    }
  }

  // Hand the bytes to the internal upload service when configured.
  // The placeholder key still lets the admin queue render a row in
  // dev — the reviewer just can't decrypt anything that wasn't
  // actually uploaded, which is the right behaviour.
  const documents = {
    pan: await storeDocument(me.id, "pan", pan),
    aadhaar: await storeDocument(me.id, "aadhaar", aadhaar),
    selfie: await storeDocument(me.id, "selfie", selfie),
  };

  const submission = await db.kycSubmission.upsert({
    where: { userId: me.id },
    create: {
      userId: me.id,
      documents,
      status: "PENDING",
    },
    update: {
      documents,
      status: "PENDING",
      // Clear prior reviewer decision fields — the new submission is
      // a fresh review request.
      rejectionCode: null,
      reviewedById: null,
      reviewedAt: null,
      notes: null,
      faceMatchScore: null,
    },
  });

  // In-app notification to the user confirming the submission.
  await db.notification.create({
    data: {
      userId: me.id,
      title: "KYC submitted",
      body: "Your identity documents are now under review. Decisions typically land within 1 business day.",
      href: "/kyc",
    },
  });

  return NextResponse.json({
    ok: true,
    submissionId: submission.id,
    status: submission.status,
  });
}

/**
 * Store one document. Production routes via the backend's internal
 * KYC upload endpoint (S3 + ClamAV + KMS); dev returns a fake key
 * so the admin queue still gets a triagable row.
 */
async function storeDocument(userId: string, kind: string, file: File): Promise<string> {
  const internalUrl = process.env.KYC_UPLOAD_INTERNAL_URL;
  const sharedSecret = process.env.INTERNAL_API_SECRET;
  if (!internalUrl || !sharedSecret) {
    // Dev fallback — placeholder key. The admin queue page surfaces
    // the document list but `getBlob(key)` will 404 in this mode.
    // Good enough for end-to-end UI testing.
    return `dev-placeholder/${userId}/${kind}/${randomBytes(8).toString("hex")}`;
  }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("userId", userId);
  fd.append("kind", kind);
  const res = await fetch(internalUrl, {
    method: "POST",
    headers: { "x-internal-secret": sharedSecret },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`KYC upload failed (${res.status})`);
  }
  const body = (await res.json()) as { key: string };
  return body.key;
}

import { ComingSoon } from "@/components/admin/ComingSoon";

export const dynamic = "force-dynamic";

export default function KycPage() {
  return (
    <ComingSoon
      kicker="Trust & safety"
      title="KYC review"
      description="Customer identity-verification queue tailored for prediction-market deposits."
      intent="Document review queue: PAN / Aadhaar / address proof scans, automated face match against the user's selfie, OCR-extracted fields cross-checked against the user-typed values. Each submission lands in PENDING; reviewer either APPROVES (lifts deposit cap), REJECTS (with reason code), or REQUESTS_MORE (back to user with a structured ask). Wired through the existing ClamAV + KMS pipeline that the auctions KYC stack already uses (PR-KYC-1)."
      needs={[
        "Bet-side KycSubmission model: { userId, documents (encrypted refs), status, reviewedBy?, rejectionCode?, autoFaceMatchScore? }.",
        "POST /api/me/kyc/submit (user side) — uploads to S3 via the shared KYCObjectStore from the backend.",
        "GET /api/admin/kyc?status=&page=",
        "POST /api/admin/kyc/[id]/approve|reject|request-more",
        "GET /api/admin/kyc/[id]/file/[index] — bytes streamed via backend (KYC documents never live in bet's filesystem).",
        "User-side KYC tier (none / level1 / level2) gates withdrawal limits per RBI guidelines.",
      ]}
    />
  );
}

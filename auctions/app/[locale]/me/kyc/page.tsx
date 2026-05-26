import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { KycClient } from "./KycClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Identity verification · Kalki" };

export type KycTier = "TIER_0" | "TIER_1" | "TIER_2" | "TIER_3";
export type ReviewState = "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "REQUIRES_RESUBMIT";
export type DocumentKind = "PAN" | "AADHAAR_LAST4" | "PASSPORT" | "VOTER_ID" | "ADDRESS_PROOF" | "SELFIE" | "LIVENESS_VIDEO";
export type ScanStatus = "PENDING" | "CLEAN" | "INFECTED" | "ERROR";

export interface KycStatus {
  tier: KycTier;
  reviewState: ReviewState;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  identityVerifiedAt: string | null;
  addressVerifiedAt: string | null;
  reviewNotes: string | null;
  maxWithdrawalCoins: number | null;
  documents: Array<{
    id: string;
    kind: DocumentKind;
    reviewState: ReviewState;
    virusScanStatus: ScanStatus;
    createdAt: string;
  }>;
}

/**
 * KYC landing page. Server-side fetches the current status (tier,
 * doc list, withdrawal cap) and hands it to the client for the
 * upload wizard. SSR vs CSR split mirrors `/me/profile` and
 * `/me/addresses` for consistency — protected page → server fetch →
 * hand off to a client component that mutates.
 *
 * Three steps to TIER_3:
 *   1. Identity (PAN / Passport / Voter ID) — unlocks TIER_2.
 *   2. Selfie — required for TIER_3.
 *   3. Address proof — required for TIER_3 + admin approval.
 *
 * The card surfaces explain the *why* alongside the *what* — KYC is
 * traditionally where users churn, so we lead with the withdrawal
 * unlock value rather than a regulatory wall of text.
 */
export default async function KycPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/kyc");

  let status: KycStatus;
  try {
    status = await backend.authed(token).get<KycStatus>("/me/kyc");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/kyc");
    throw err;
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          ← Account
        </Link>
        <h1 className="mt-3 mb-1 text-2xl font-black">Identity verification</h1>
        <p className="mb-6 text-sm text-slate-400">
          Higher tiers unlock larger withdrawals. Documents are
          encrypted at rest and only seen by Kalki's compliance team.
        </p>

        <KycClient initial={status} />
      </div>
    </main>
  );
}

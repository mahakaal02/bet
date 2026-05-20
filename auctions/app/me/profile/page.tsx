import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { ProfileClient } from "./ProfileClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile · Kalki Auctions" };

export interface ProfileData {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  renameAvailableAt: string | null;
}

/**
 * Editable profile page. Display name + avatar.
 *
 * `username` stays the immutable handle (admin-only changes) — this
 * page is for the looser `displayName` plus the avatar image. Username
 * changes happen via /admin/users when needed.
 */
export default async function MyProfilePage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/profile");

  let profile: ProfileData;
  try {
    profile = await backend.authed(token).get<ProfileData>("/me/profile");
  } catch (err) {
    if (err instanceof BackendUnauthorized) redirect("/login?next=/me/profile");
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
        <h1 className="mt-3 mb-1 text-2xl font-black">Profile</h1>
        <p className="mb-6 text-sm text-slate-400">
          Your @{profile.username} handle is the unique identifier
          (visible in bid timelines + transfer receipts). Your display
          name + avatar are what other users see in feeds.
        </p>
        <ProfileClient initial={profile} />
      </div>
    </main>
  );
}

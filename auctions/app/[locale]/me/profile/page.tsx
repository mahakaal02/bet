import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";
import { ProfileClient } from "./ProfileClient";

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
    path: "/me/profile",
    title: t("meta.profileTitle", locale),
    description: t("meta.profileDescription", locale),
    noindex: true,
  });
}

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
export default async function MyProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (path: string) => localizedPath(path, locale);

  const token = await getSessionToken();
  if (!token) redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/me/profile"))}`);

  let profile: ProfileData;
  try {
    profile = await backend.authed(token).get<ProfileData>("/me/profile");
  } catch (err) {
    if (err instanceof BackendUnauthorized)
      redirect(`${lp("/login")}?next=${encodeURIComponent(lp("/me/profile"))}`);
    throw err;
  }

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href={lp("/profile")}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
        >
          {tr("me.accountLink")}
        </Link>
        <h1 className="mt-3 mb-1 text-2xl font-black">{tr("me.profileHeading")}</h1>
        <p className="mb-6 text-sm text-slate-400">
          {tr("me.profileSubtext", { handle: profile.username })}
        </p>
        <ProfileClient initial={profile} />
      </div>
    </main>
  );
}

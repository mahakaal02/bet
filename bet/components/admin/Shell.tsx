"use client";

import { signOut } from "next-auth/react";
import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ToastHost } from "./ui/primitives";

/**
 * Client-side admin shell (PR-BET-ADMIN-REDESIGN).
 *
 * The server-rendered layout (`bet/app/admin/layout.tsx`) handles the
 * auth gate, then hands the resolved admin username down to this
 * client component which mounts the sidebar + topbar + toast host.
 *
 * Why split server/client: the auth check needs server-side cookies
 * via `getAuthedUser()`, but the sidebar's collapse-state persistence
 * + topbar's theme toggle + popovers all need client interactivity.
 * Keeping the gate server-side avoids any flash of unauthorised
 * content before the redirect fires.
 */
export function AdminShell({
  username,
  children,
}: {
  username: string;
  children: ReactNode;
}) {
  async function handleSignOut() {
    // Mirror the existing SignOutCard chain: clear NextAuth, then
    // forward through the cross-app SSO logout chain so all three
    // Kalki apps are signed out together. The Auctions side will
    // honour the `kalki_logged_out` cookie set by bet/sso-logout
    // (PR-WEB-LOGOUT-FIX).
    await signOut({ redirect: false }).catch(() => {});
    const auctions = process.env.NEXT_PUBLIC_AUCTIONS_URL ?? "http://localhost:3200";
    const aviator = process.env.NEXT_PUBLIC_AVIATOR_URL ?? "http://localhost:3000";
    const final = `${auctions.replace(/\/$/, "")}/login`;
    const auctionsStep = `${auctions.replace(/\/$/, "")}/api/auth/sso-logout?next=${encodeURIComponent(final)}`;
    const aviatorStep = `${aviator.replace(/\/$/, "")}/logout?next=${encodeURIComponent(auctionsStep)}`;
    window.location.replace(aviatorStep);
  }

  return (
    <div className="admin-root flex">
      <Sidebar username={username} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Topbar username={username} onSignOut={handleSignOut} />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
      <ToastHost />
    </div>
  );
}

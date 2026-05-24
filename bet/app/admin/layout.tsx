import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/Shell";
import { getAuthedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Server layout for `/admin/*` — single responsibility: gate access
 * (PR-BET-ADMIN-REDESIGN).
 *
 * The visual shell (sidebar, topbar, toast host, theme toggle) lives
 * in the client component `<AdminShell>`. This split keeps the auth
 * check on the server so unauthorised visitors get a clean redirect
 * to /login without ever seeing the admin chrome flash.
 *
 * Was a flat sidebar + Navbar inside the layout — replaced with a
 * proper fintech-style chrome (collapsible nav sections, search,
 * notifications bell, dark/light theme toggle, profile menu). The
 * old `AdminSidebar` and the user-facing `Navbar` are no longer
 * rendered on /admin/* routes; the admin has its own chrome end-
 * to-end so it can have its own theme and not bleed user-side
 * styling into operator workflows.
 *
 * Note: the old `AdminSidebar.tsx` component file is retained
 * untouched in case any non-admin page imports it (none did at PR
 * time, but worth keeping for safety since this is a UI-only PR
 * with a strict no-break-existing-code constraint).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const u = await getAuthedUser();
  if (!u) redirect("/login?next=/admin");
  if (!u.isAdmin) redirect("/");

  return <AdminShell username={u.username}>{children}</AdminShell>;
}

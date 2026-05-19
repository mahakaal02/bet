import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { AdminSidebar } from "@/components/AdminSidebar";
import { getAuthedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Shared layout for every `/admin/*` page on the Exchange.
 *
 * Two responsibilities:
 *
 *   1. Auth gate — bounce signed-out visitors to /login, regular users
 *      to /. Doing this at the layout level means individual pages
 *      don't have to re-check (though several still do, defence in
 *      depth). Per Next.js App Router, the layout's gate runs before
 *      the page renders, so unauthorised visitors never see the
 *      sidebar even briefly.
 *
 *   2. Chrome — a persistent left nav with section groups (Markets /
 *      Moderation / Operations). Modern PM admin consoles all run
 *      this shape; without a sidebar the previous version forced
 *      admins to bounce back to /admin to navigate.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const u = await getAuthedUser();
  if (!u) redirect("/login?next=/admin");
  if (!u.isAdmin) redirect("/");

  return (
    <main className="min-h-screen pb-20">
      <Navbar />
      <div className="mx-auto flex w-full max-w-7xl gap-4 px-4">
        <AdminSidebar />
        {/* `min-w-0` is important: child pages with overflow-x scroll
            (tables, code blocks) need their flex item to shrink, otherwise
            the flex parent stretches to fit and the sidebar gets pushed
            offscreen. */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </main>
  );
}

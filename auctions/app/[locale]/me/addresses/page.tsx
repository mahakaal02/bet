import Link from "next/link";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { AddressesClient } from "./AddressesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shipping addresses · Kalki Auctions" };

export interface Address {
  id: string;
  fullName: string;
  phoneE164: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryIso2: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: Address[];
}

/**
 * Saved-address manager. Server-renders the list so the page shows
 * the right state on first paint; the editor + actions live in the
 * client component.
 */
export default async function AddressesPage() {
  const token = await getSessionToken();
  if (!token) redirect("/login?next=/me/addresses");

  let items: Address[] = [];
  try {
    const res = await backend.authed(token).get<ListResponse>("/me/addresses");
    items = res.items;
  } catch (err) {
    if (err instanceof BackendUnauthorized) {
      redirect("/login?next=/me/addresses");
    }
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
          ← Profile
        </Link>
        <h1 className="mt-3 mb-1 text-2xl font-black">Shipping addresses</h1>
        <p className="mb-6 text-sm text-slate-400">
          Used when you win an auction. Up to 10 saved addresses;
          one is always your default. Lower-then-raise: edit any
          field; refusing to remove your only default keeps you
          shippable.
        </p>
        <AddressesClient initial={items} />
      </div>
    </main>
  );
}

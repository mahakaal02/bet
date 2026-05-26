import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { MarketForm } from "@/components/MarketForm";
import { getAuthedUser } from "@/lib/auth";
import { hubLoginUrl } from "@/lib/hub";

export const dynamic = "force-dynamic";

export default async function NewMarketPage() {
  const u = await getAuthedUser();
  if (!u) redirect(hubLoginUrl());
  if (!u.isAdmin) redirect("/");

  return (
    <>
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-black">New market</h1>
        <p className="mb-4 text-sm text-slate-400">
          Once created, an AMM seeds 1000/1000 YES/NO shares — initial price 50/50.
        </p>
        <Card>
          <MarketForm />
        </Card>
      </div>
    </>
  );
}

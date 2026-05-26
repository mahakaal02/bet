import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { detectCountry } from "@/lib/locale-detect";
import { isTelegramConfigured } from "@/lib/telegram";
import { LoginLanding } from "./LoginLanding";

/**
 * Hub login + landing page (PR-LOGIN-REDESIGN).
 *
 * Server shell. Resolves locale (geo → cookie → Accept-Language →
 * default) and Telegram-config flag, then renders the client-side
 * `<LoginLanding/>` with everything pre-populated so the first
 * paint matches the post-hydration UI exactly (no locale flash,
 * no SSR/CSR mismatch).
 *
 * Already-signed-in users skip the landing and go straight to the
 * `?next=` target (default `/` — the hub's three-tile game picker).
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "kalki.bet — trade instinct, cash out before it crashes",
  description:
    "Prediction markets, Aviator crash and lowest-unique-bid auctions. One wallet. Three ways to print. Cash out before everyone else does.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = await getSessionToken();

  // Normalise the `next` query — same-origin paths only, default to
  // the hub home. Cross-origin redirects after login are a phishing
  // vector and the auctions hub deliberately doesn't follow them.
  const rawNext = sp.next;
  const nextParam = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const safeNext = nextParam && nextParam.startsWith("/") ? nextParam : "/";
  if (token) redirect(safeNext);

  const initialCountry = await detectCountry(sp);

  return (
    <LoginLanding
      initialCountry={initialCountry}
      next={safeNext}
      telegramEnabled={isTelegramConfigured()}
    />
  );
}

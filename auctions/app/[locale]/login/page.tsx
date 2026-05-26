import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { detectCountry } from "@/lib/locale-detect";
import { LoginLanding } from "./LoginLanding";

/**
 * Hub login + landing page (PR-LOGIN-REDESIGN).
 *
 * Server shell. Resolves locale (geo → cookie → Accept-Language →
 * default), then renders the client-side `<LoginLanding/>` with
 * everything pre-populated so the first paint matches the post-
 * hydration UI exactly (no locale flash, no SSR/CSR mismatch).
 *
 * Already-signed-in users skip the landing and go straight to the
 * `?next=` target (default `/` — the hub's three-tile game picker).
 *
 * Telegram OAuth is intentionally NOT gated server-side anymore.
 * The design treats it as the canonical sign-in path (it's the only
 * social-auth option after PR-AUTH-CLEANUP dropped Google + Apple)
 * so the button always renders. If the Telegram env vars
 * (`TELEGRAM_BOT_TOKEN` server-side, `NEXT_PUBLIC_TELEGRAM_BOT`
 * client-side) aren't configured, clicking the button hits
 * `/api/auth/telegram/start` which surfaces an explicit 503 with
 * a fix-the-env message — strictly better UX than silently hiding
 * the only OAuth entry point.
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

  // Demo-user chips are a dev/QA convenience only — they expose the
  // seeded `password12345` account list. Anything other than a
  // strict production build can show them; CI / staging set
  // NODE_ENV=production so they stay hidden there.
  const demoVisible = process.env.NODE_ENV !== "production";

  return (
    <LoginLanding
      initialCountry={initialCountry}
      next={safeNext}
      demoVisible={demoVisible}
    />
  );
}

import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { detectCountry } from "@/lib/locale-detect";
import { backend } from "@/lib/backend";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n";
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
  title: "kalki — trade instinct, cash out before it crashes",
  description:
    "Prediction markets, Aviator crash and lowest-unique-bid auctions. One wallet. Three ways to print. Cash out before everyone else does.",
};

/**
 * Is the `kalki_token` session still accepted by the backend? Mirrors
 * the hub's gate (`app/[locale]/page.tsx` → GET /auth/me). ANY failure —
 * 401, network error, backend down — counts as "not valid" so we render
 * the login form rather than redirect into the hub's auth check (which
 * would bounce straight back here → redirect loop).
 */
async function sessionIsValid(token: string): Promise<boolean> {
  try {
    await backend.authed(token).get("/auth/me");
    return true;
  } catch {
    return false;
  }
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const sp = await searchParams;
  const token = await getSessionToken();

  // Normalise the `next` query — same-origin paths only. CRITICAL:
  // default to the localized hub (`/en`), NEVER bare "/". The apex "/"
  // is Traefik-rewritten back to THIS login page (kalki-bet-domain.yaml
  // `kalki-bet-rewrite-root`), so sending an authenticated user to "/"
  // creates an infinite /↔/en/login loop (ERR_TOO_MANY_REDIRECTS).
  // Cross-origin redirects after login are also a phishing vector — the
  // hub deliberately follows same-origin paths only.
  const rawNext = sp.next;
  const nextParam = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const safeNext =
    nextParam && nextParam.startsWith("/") && nextParam !== "/"
      ? nextParam
      : `/${locale}`;

  // Only redirect a *valid* session away from the login page. A
  // present-but-invalid cookie (expired 7d JWT, rotated secret, backend
  // down) must fall through and render the form — otherwise the hub
  // bounces back here on its /auth/me 401 and we loop forever.
  if (token && (await sessionIsValid(token))) redirect(safeNext);

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

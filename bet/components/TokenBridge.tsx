"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { useTranslation } from "@/lib/i18n/client";

/**
 * Single-sign-on bridge from the auctions backend → Bet (Kalki Exchange).
 *
 * The Android WebView opens the Bet root with `?token=<backendJWT>` when
 * the user has a live backend session. We hand the token to the
 * `backend-jwt` NextAuth provider which verifies the HMAC against
 * `BACKEND_JWT_SECRET` and either signs the user in (matching email)
 * or provisions a fresh Bet account.
 *
 * # Why this renders a full-page overlay
 *
 * The first iteration returned `null` and ran the sign-in in an effect.
 * That left a brief race window where the landing page was already
 * interactive but the session cookie wasn't set — a user who tapped the
 * "Sign in" link in the navbar before the effect resolved would loop
 * through the manual /login form. Blocking the page with a spinner
 * overlay until either signIn() resolves or we know there's no token
 * to consume eliminates that window.
 *
 * After successful sign-in we call `router.refresh()` so the page re-
 * renders server-side WITH the freshly-set session cookie — otherwise
 * the user sees the unauthenticated landing layout even though they're
 * signed in until the next navigation.
 */
export function TokenBridge() {
  const params = useSearchParams();
  const router = useRouter();
  const { status } = useSession();
  const handled = useRef(false);
  const [working, setWorking] = useState(false);

  const { t } = useTranslation();

  useEffect(() => {
    if (handled.current) return;
    const tok = params.get("token");
    if (!tok) return;
    if (status === "loading") return;
    handled.current = true;

    const finish = () => {
      router.replace("/");
      router.refresh();
      setWorking(false);
    };

    if (status === "authenticated") {
      finish();
      return;
    }

    setWorking(true);
    void signIn("backend-jwt", { token: tok, redirect: false })
      .catch(() => {
        // signIn() doesn't throw on bad creds in v4 — it resolves with
        // { error }. The catch is defensive against network failures only.
      })
      .finally(finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (!working) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-slate-950/95 text-slate-200 backdrop-blur-sm">
      <span
        aria-hidden
        className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500/30 border-t-cyan-300"
      />
      <p className="text-sm font-semibold text-slate-300">{t("auth.signingYouIn")}</p>
      <p className="text-xs text-slate-500">
        {t("auth.bridgingSession")}
      </p>
    </div>
  );
}

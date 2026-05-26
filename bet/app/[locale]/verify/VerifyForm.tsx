"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DEFAULT_LOCALE,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";

type State = "loading" | "ok" | "invalid";

export function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const routeParams = useParams<{ locale: string }>();
  const locale: Locale = isLocale(routeParams.locale)
    ? routeParams.locale
    : DEFAULT_LOCALE;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const lp = (h: string) => localizedPath(h, locale);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setState("invalid");
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (cancelled) return;
      setState(res.ok ? "ok" : "invalid");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-md px-4 py-12">
        <Badge tone="info" className="mb-3">{tr("meta.siteName")}</Badge>
        <h1 className="text-2xl font-black">{tr("auth.emailVerificationHeading")}</h1>

        <Card className="mt-4">
          {state === "loading" && <p className="text-sm">{tr("auth.verifyingLink")}</p>}
          {state === "ok" && (
            <>
              <p className="text-sm text-emerald-300">
                {tr("auth.verifySuccess")}
              </p>
              <Button
                className="mt-4 w-full"
                onClick={() => router.replace(lp("/profile"))}
              >
                {tr("auth.continueProfileButton")}
              </Button>
            </>
          )}
          {state === "invalid" && (
            <>
              <p className="text-sm text-rose-300">
                {tr("auth.verifyInvalidLink")}
              </p>
              <Link href={lp("/profile")} className="mt-3 inline-block text-sm text-cyan-300">
                {tr("auth.requestNewVerifyLink")}
              </Link>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}

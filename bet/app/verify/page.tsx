"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type State = "loading" | "ok" | "invalid";

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <Verify />
    </Suspense>
  );
}

function Verify() {
  const router = useRouter();
  const params = useSearchParams();
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
        <Badge tone="info" className="mb-3">Kalki Exchange</Badge>
        <h1 className="text-2xl font-black">Email verification</h1>

        <Card className="mt-4">
          {state === "loading" && <p className="text-sm">Verifying your link…</p>}
          {state === "ok" && (
            <>
              <p className="text-sm text-emerald-300">
                ✅ Your email is verified. Welcome aboard.
              </p>
              <Button
                className="mt-4 w-full"
                onClick={() => router.replace("/profile")}
              >
                Continue to profile
              </Button>
            </>
          )}
          {state === "invalid" && (
            <>
              <p className="text-sm text-rose-300">
                This link is invalid or has expired.
              </p>
              <Link href="/profile" className="mt-3 inline-block text-sm text-cyan-300">
                Request a new one →
              </Link>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}

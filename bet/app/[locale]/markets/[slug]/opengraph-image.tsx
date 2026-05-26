import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Kalki Exchange market";

/**
 * Per-market OG card. Bakes the title, current YES/NO marginal prices and
 * a category chip into a 1200×630 PNG so a shared market URL unfurls into
 * something actually informative — not just the generic site card.
 *
 * Note: prices reflect the AMM marginal at request time. They're a snapshot,
 * not live, since OG images are cached by the unfurling client (Slack,
 * Twitter, etc.) for ~30 minutes typically.
 */
export default async function OgImage({
  params,
}: {
  params: { slug: string };
}) {
  const market = await db.market.findUnique({
    where: { slug: params.slug },
    select: {
      title: true,
      category: true,
      yesShares: true,
      noShares: true,
      status: true,
      resolvedAs: true,
    },
  });

  // Missing markets get the site default — let Next fall through by
  // returning a tiny placeholder that still renders.
  if (!market) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "#0d1117",
            color: "#94a3b8",
            fontFamily: "system-ui",
          }}
        >
          Market not found
        </div>
      ),
      { ...size },
    );
  }

  const resolved = market.status === "RESOLVED";
  const yes = resolved
    ? market.resolvedAs === "YES"
      ? 1
      : 0
    : priceYes({ yesShares: market.yesShares, noShares: market.noShares });
  const yesLabel = yes.toFixed(2);
  const noLabel = (1 - yes).toFixed(2);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: 64,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          color: "#e5e7eb",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
          background:
            "radial-gradient(circle at 20% 20%, rgba(34,211,238,0.18), transparent 40%)," +
            "radial-gradient(circle at 80% 80%, rgba(129,140,248,0.18), transparent 50%)," +
            "linear-gradient(135deg, #0d1117 0%, #07090e 100%)",
        }}
      >
        {/* Top: brand mark + category chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: 14 }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background:
                  "linear-gradient(135deg, #22d3ee 0%, #818cf8 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#0f172a",
                fontWeight: 900,
                fontSize: 28,
              }}
            >
              K
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#cbd5e1",
                display: "flex",
              }}
            >
              Kalki Exchange
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            {resolved && (
              <div
                style={{
                  padding: "8px 18px",
                  borderRadius: 999,
                  background:
                    market.resolvedAs === "YES"
                      ? "rgba(16,185,129,0.18)"
                      : "rgba(239,68,68,0.18)",
                  color:
                    market.resolvedAs === "YES" ? "#6ee7b7" : "#fda4af",
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  display: "flex",
                }}
              >
                RESOLVED {market.resolvedAs ?? "—"}
              </div>
            )}
            <div
              style={{
                padding: "8px 18px",
                borderRadius: 999,
                border: "1px solid #334155",
                color: "#94a3b8",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 1.2,
                display: "flex",
              }}
            >
              {market.category}
            </div>
          </div>
        </div>

        {/* Middle: title */}
        <div
          style={{
            fontSize: market.title.length > 80 ? 44 : 56,
            fontWeight: 900,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            color: "#f8fafc",
            display: "flex",
            // ImageResponse doesn't support line-clamp; long titles wrap.
            maxWidth: 1072,
          }}
        >
          {market.title}
        </div>

        {/* Bottom: YES / NO prices */}
        <div
          style={{
            display: "flex",
            gap: 24,
          }}
        >
          <PriceTile label="YES" value={yesLabel} accent="#34d399" />
          <PriceTile label="NO" value={noLabel} accent="#fb7185" />
        </div>
      </div>
    ),
    { ...size },
  );
}

function PriceTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        padding: 28,
        borderRadius: 18,
        background: "rgba(15,23,42,0.6)",
        border: "1px solid rgba(148,163,184,0.18)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 2,
          color: "#94a3b8",
          display: "flex",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 96,
          fontWeight: 900,
          color: accent,
          letterSpacing: -3,
          display: "flex",
        }}
      >
        {value}
      </div>
    </div>
  );
}

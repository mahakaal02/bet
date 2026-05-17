import { ImageResponse } from "next/og";

// 1200×630 is the canonical OG card size — what Slack, Twitter, LinkedIn,
// iMessage all render. Next bakes this file into the root route's metadata
// automatically; sibling files like `app/markets/[slug]/opengraph-image`
// override it for specific routes.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Kalki Exchange · Prediction markets";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: 80,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
          color: "#e5e7eb",
          background:
            "radial-gradient(circle at 20% 20%, rgba(34,211,238,0.18), transparent 40%)," +
            "radial-gradient(circle at 80% 80%, rgba(129,140,248,0.18), transparent 50%)," +
            "linear-gradient(135deg, #0d1117 0%, #07090e 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background:
                "linear-gradient(135deg, #22d3ee 0%, #818cf8 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0f172a",
              fontWeight: 900,
              fontSize: 36,
            }}
          >
            K
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: -0.5,
              background:
                "linear-gradient(135deg, #22d3ee 0%, #818cf8 100%)",
              backgroundClip: "text",
              color: "transparent",
              display: "flex",
            }}
          >
            Kalki Exchange
          </div>
        </div>

        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            lineHeight: 1.05,
            letterSpacing: -2,
            color: "#f8fafc",
            marginBottom: 24,
            display: "flex",
          }}
        >
          Trade prediction markets
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 500,
            color: "#94a3b8",
            display: "flex",
          }}
        >
          YES / NO on real-world events. Same wallet across auctions and Aviator.
        </div>
      </div>
    ),
    { ...size },
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { fmtCoins, cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Window = 7 | 14 | 30 | 90;

interface Point {
  day: string;
  volume: number;
  trades: number;
  signups: number;
  /** Daily platform commission revenue (buy + sell + settlement). */
  revenue: number;
}

interface TopMarket {
  id: string;
  slug: string;
  title: string;
  status: string;
  volume: number;
  trades: number;
}

interface Resp {
  series: Point[];
  summary: {
    activeMarkets: number;
    openOrders: number;
    totalCoinsHeld: number;
    /** Distinct users who placed a trade in the window. */
    activeUsers: number;
    /** Σ position.shares × current marginal price across OPEN markets. */
    openInterest: number;
    /** Lifetime platform revenue, broken down by source. */
    totalTradingFees: number;
    totalSettlementFees: number;
    totalPlatformRevenue: number;
    windowDays: number;
  };
  topMarkets: TopMarket[];
}

/**
 * Time-series block on the admin dashboard. One chart, four lines (volume
 * + platform revenue on the left axis, trades + signups on the right axis).
 * Toggle the window with the chips at the top-right.
 *
 * Stat tiles on top: active markets, active users (windowed), open orders,
 * coins held, open interest, lifetime platform revenue.
 *
 * Top-markets leaderboard below the chart shows the 5 highest-volume
 * markets in the window — quick at-a-glance for "what is everyone trading
 * right now."
 *
 * Reads from `/api/admin/analytics?days=…`. Admin-only on the server.
 */
export function AdminAnalytics() {
  const [days, setDays] = useState<Window>(14);
  const { data, isLoading } = useSWR<Resp>(
    `/api/admin/analytics?days=${days}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytics · last {days} days</CardTitle>
        <div className="flex gap-1">
          {([7, 14, 30, 90] as Window[]).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition",
                d === days
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200",
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </CardHeader>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Active markets" value={data?.summary.activeMarkets} />
        <Stat label={`Active users (${days}d)`} value={data?.summary.activeUsers} />
        <Stat label="Open orders" value={data?.summary.openOrders} />
        <Stat label="Coins held" value={data?.summary.totalCoinsHeld} />
        <Stat label="Open interest" value={data?.summary.openInterest} accent="violet" />
        <Stat
          label="Platform revenue"
          value={data?.summary.totalPlatformRevenue}
          accent="emerald"
          sub={
            data
              ? `Trading ${fmtCoins(data.summary.totalTradingFees)} · Settlement ${fmtCoins(
                  data.summary.totalSettlementFees,
                )}`
              : undefined
          }
        />
      </div>

      {isLoading || !data ? (
        <div className="skeleton h-56 w-full" />
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.series} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="day"
                stroke="#475569"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                }
                minTickGap={20}
              />
              <YAxis
                yAxisId="left"
                stroke="#22d3ee"
                tick={{ fontSize: 10 }}
                width={50}
                tickFormatter={(v) => fmtCoins(v)}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#818cf8"
                tick={{ fontSize: 10 }}
                width={32}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #1f2937",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(v) => new Date(v).toLocaleDateString()}
                formatter={(value: number, name: string) => {
                  if (name === "Volume (coins)" || name === "Revenue (coins)") {
                    return [fmtCoins(value), name];
                  }
                  return [value, name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="volume"
                name="Volume (coins)"
                stroke="#22d3ee"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="revenue"
                name="Revenue (coins)"
                stroke="#34d399"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="trades"
                name="Trades"
                stroke="#818cf8"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="signups"
                name="Signups"
                stroke="#facc15"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top markets leaderboard. Hidden until we have data so the tile
          doesn't shift in late. */}
      {data && data.topMarkets.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Top markets · last {days}d
            </div>
            <Link
              href="/admin/markets"
              className="text-[11px] text-cyan-400 hover:text-cyan-200"
            >
              All →
            </Link>
          </div>
          <ol className="space-y-1.5">
            {data.topMarkets.map((m, i) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/40 px-2.5 py-1.5"
              >
                <span className="w-5 shrink-0 text-center text-[11px] font-mono text-slate-500">
                  {i + 1}
                </span>
                <Link
                  href={`/markets/${m.slug}`}
                  className="flex-1 truncate text-sm text-slate-200 hover:text-cyan-300"
                  title={m.title}
                >
                  {m.title}
                </Link>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                  {fmtCoins(m.volume)} · {m.trades} tr
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | undefined;
  sub?: string;
  accent?: "emerald" | "violet";
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div
        className={cn(
          "text-lg font-black",
          accent === "emerald"
            ? "text-emerald-300"
            : accent === "violet"
              ? "text-violet-300"
              : "text-slate-100",
        )}
      >
        {value === undefined ? "—" : fmtCoins(value)}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">{sub}</div>}
    </div>
  );
}

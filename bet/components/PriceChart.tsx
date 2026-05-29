"use client";

import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useTranslation } from "@/lib/i18n/client";

interface Point {
  t: number;
  y: number;
}

export function PriceChart({
  points,
  fallbackY,
}: {
  points: Point[];
  fallbackY: number;
}) {
  const { locale } = useTranslation();
  // If we only have 1 or 0 points, synthesize an opening sample so the line
  // chart has something to draw. The opening sample is just the current
  // mid-market — gives a flat line, but communicates "no movement yet"
  // better than an empty box.
  const data: Point[] =
    points.length >= 2
      ? points
      : points.length === 1
        ? [{ t: points[0].t - 60_000, y: points[0].y }, points[0]]
        : [
            { t: Date.now() - 60_000, y: fallbackY },
            { t: Date.now(), y: fallbackY },
          ];

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="t"
            tickFormatter={(v) =>
              new Date(v).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })
            }
            stroke="#475569"
            tick={{ fontSize: 10 }}
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v) => v.toFixed(2)}
            stroke="#475569"
            tick={{ fontSize: 10 }}
            width={36}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #1f2937",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => new Date(v).toLocaleString(locale)}
            formatter={(v: number) => [`${v.toFixed(3)} YES`, "Price"]}
          />
          <Line
            type="monotone"
            dataKey="y"
            stroke="#22d3ee"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

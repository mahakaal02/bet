"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { ThemeSwitch } from "@/app/[locale]/wallet/wallet-client";
import { Comments, type CommentRow } from "@/components/Comments";
import { useMarketStream } from "@/lib/useMarketStream";
import { groupDisplayPrices } from "@/lib/market-group";
import { fmtCoins } from "@/lib/utils";
import { hubHomeUrl } from "@/lib/hub";
import { localizedPath, useTranslation } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";

/* ─────────────────────────────────────────────────────────────
   Shared props (server → client)
   ───────────────────────────────────────────────────────────── */

export interface EventCandidate {
  id: string;
  slug: string;
  title: string;
  status: "OPEN" | "CLOSED" | "RESOLVED" | "CANCELLED";
  resolvedAs: "YES" | "NO" | null;
  /** Raw YES price, 0..1 (resolution-clamped by the server). */
  yesPrice: number;
  volumeCoins: number;
  liquidity: number;
  /** YES probability history, 0..100, evenly sampled. */
  series: number[];
}

export interface EventTrade {
  id: string;
  username: string;
  outcome: "YES" | "NO";
  cost: number;
  shares: number;
  marketTitle: string;
  marketSlug: string;
  at: string;
}

interface EventDetailViewProps {
  locale: Locale;
  slug: string;
  title: string;
  description: string | null;
  categoryLabel: string;
  exclusive: boolean;
  resolved: boolean;
  status: string;
  candidates: EventCandidate[];
  trades: EventTrade[];
  totalVolume: number;
  totalLiquidity: number;
  tradersCount: number;
  resolvesAt: number | null;
  authed: boolean;
  /** Wallet balance (coins) for the topbar pill; null when signed out. */
  balance?: number | null;
  /** Username for the topbar avatar initial; null when signed out. */
  username?: string | null;
  /** Server-rendered comment threads keyed by candidate market id. */
  initialComments?: Record<string, CommentRow[]>;
}

/** Stable accent palette — assigned by candidate sort order so a given
 *  candidate keeps its colour across re-sorts of the live ranking. */
const PALETTE = [
  "#22D3EE",
  "#F472B6",
  "#FBBF24",
  "#A78BFA",
  "#34D399",
  "#60A5FA",
  "#FB7185",
  "#FCD34D",
  "#4ADE80",
  "#C084FC",
  "#94A3B8",
];

// Cap concurrent per-candidate SSE streams. Browsers allow only ~6 HTTP/1.1
// connections per origin, and each live candidate holds one open EventSource;
// keeping this below 6 leaves a connection free for other requests (e.g. the
// comments fetch) so they don't starve behind the open streams in dev.
const LIVE_CAP = 5;
const CHART_W = 800;
const CHART_H = 320;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeAgoShort(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

/** Format a 0..100 percentage as a 0..1 decimal string (e.g. 52 → "0.52"). */
function pctToDec(p: number): string {
  return (p / 100).toFixed(2);
}

const RANGES: { id: string; label: string; frac: number }[] = [
  { id: "1d", label: "1D", frac: 0.12 },
  { id: "1w", label: "1W", frac: 0.3 },
  { id: "1m", label: "1M", frac: 0.6 },
  { id: "all", label: "ALL", frac: 1 },
];

export function EventDetailView({
  locale,
  title,
  description,
  categoryLabel,
  exclusive,
  resolved,
  status,
  candidates,
  trades,
  totalVolume,
  totalLiquidity,
  tradersCount,
  resolvesAt,
  authed,
  balance,
  username,
  initialComments,
}: EventDetailViewProps) {
  const { t } = useTranslation();
  const lp = useCallback((h: string) => localizedPath(h, locale), [locale]);

  // Stable colour map keyed by candidate id (sort order = group order).
  const colorById = useMemo(() => {
    const m = new Map<string, string>();
    candidates.forEach((c, i) => m.set(c.id, PALETTE[i % PALETTE.length]));
    return m;
  }, [candidates]);

  /* ----- live prices (per child SSE), seeded from SSR ----- */
  const [prices, setPrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(candidates.map((c) => [c.id, c.yesPrice])),
  );
  const onTick = useCallback((id: string, yesPrice: number) => {
    setPrices((prev) => (prev[id] === yesPrice ? prev : { ...prev, [id]: yesPrice }));
  }, []);
  const liveIds = useMemo(() => {
    const top = [...candidates]
      .sort((a, b) => b.yesPrice - a.yesPrice)
      .slice(0, LIVE_CAP);
    return new Set(top.map((c) => c.id));
  }, [candidates]);

  const deferredPrices = useDeferredValue(prices);

  const ranked = useMemo(() => {
    const display = groupDisplayPrices(
      candidates.map((c) => ({
        marketId: c.id,
        yesPrice: deferredPrices[c.id] ?? c.yesPrice,
      })),
      exclusive,
    );
    const pctById = new Map(display.map((d) => [d.marketId, d.normalizedPct]));
    return [...candidates]
      .map((c) => ({
        cand: c,
        live: deferredPrices[c.id] ?? c.yesPrice,
        normPct: pctById.get(c.id) ?? 0,
      }))
      .sort((a, b) => b.live - a.live);
  }, [candidates, deferredPrices, exclusive]);

  /* ----- selection + ticket state ----- */
  const [selectedId, setSelectedId] = useState<string>(
    () => ranked[0]?.cand.id ?? candidates[0]?.id ?? "",
  );
  const [side, setSide] = useState<"y" | "n">("y");
  const [qty, setQty] = useState<number>(250);
  const [tab, setTab] = useState<"overview" | "activity" | "comments">("overview");
  const [range, setRange] = useState<string>("all");

  /* Selecting a candidate (row click, Buy button, or the rail dropdown)
     loads it into the trade ticket, scrolls the ticket into view and pulses
     it so the user notices the change. We bump a counter and alternate
     between two identical keyframes (blink-a / blink-b) so the CSS animation
     restarts every time — even when the same candidate is re-selected, which
     a single boolean flag would fail to re-fire. */
  const [blinkN, setBlinkN] = useState(0);
  const ticketRef = useRef<HTMLDivElement>(null);
  const selectCand = useCallback((id: string, s?: "y" | "n") => {
    setSelectedId(id);
    if (s) setSide(s);
    setBlinkN((n) => n + 1);
    requestAnimationFrame(() => {
      ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);
  const blinkClass =
    blinkN === 0 ? "" : blinkN % 2 === 1 ? " blink-a" : " blink-b";

  const selected =
    candidates.find((c) => c.id === selectedId) ?? candidates[0] ?? null;
  const selLive = selected ? (deferredPrices[selected.id] ?? selected.yesPrice) : 0;
  const yesCents = Math.round(selLive * 100);
  const px = side === "y" ? yesCents : 100 - yesCents;
  const cost = (qty * px) / 100;
  const payout = qty;
  const profit = payout - cost - cost * 0.005;

  /* ----- chart hidden lines ----- */
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const toggleLine = (id: string) =>
    setHidden((h) => ({ ...h, [id]: !h[id] }));

  const topbar = (
    <EventTopbar
      lp={lp}
      t={t}
      balance={balance}
      username={username}
    />
  );

  if (!selected) {
    return (
      <div className="wlt evt">
        <BgStack />
        {topbar}
        <div className="evt-wrap">
          <div className="evt-empty">{t("group.empty")}</div>
        </div>
        <style>{EVT_CSS}</style>
      </div>
    );
  }

  return (
    <div className="wlt evt">
      <BgStack />
      {topbar}

      {/* Event status strip — same treatment as the Wallet status strip. */}
      <div className="status-strip">
        <div className="status-inner">
          <span className="live">
            {t("group.candidateCount", {
              count: candidates.length,
              s: candidates.length === 1 ? "" : "s",
            })}
          </span>
          <span className="sep">·</span>
          <span>{exclusive ? "Winner-takes-all" : "Independent"}</span>
          {resolvesAt && (
            <>
              <span className="sep">·</span>
              <span>Resolves {new Date(resolvesAt).toLocaleDateString(locale)}</span>
            </>
          )}
          {resolved && (
            <>
              <span className="sep">·</span>
              <span className="resolved">
                {status === "CANCELLED" ? t("market.cancelled") : t("market.resolved")}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="evt-wrap">
        {/* breadcrumbs */}
        <div className="evt-crumbs">
          <Link href={lp("/markets")}>{t("nav.markets")}</Link>
          <span>›</span>
          <span>{categoryLabel}</span>
          <span>›</span>
          <span className="cur">{title}</span>
        </div>

        {/* head */}
        <header className="evt-head">
          <div className="tags">
            <span className="tag">{categoryLabel}</span>
            {resolved && (
              <span className="tag warn">
                {status === "CANCELLED" ? t("market.cancelled") : t("market.resolved")}
              </span>
            )}
          </div>
          <h1 className="evt-title">{title}</h1>
          <div className="evt-meta">
            <Meta label={t("market.volume")} value={`${fmtCoins(totalVolume)}`} />
            <Meta label={t("market.liquidity")} value={`${fmtCoins(totalLiquidity)}`} />
            <Meta label="Traders" value={`${fmtCoins(tradersCount)}`} />
            <Meta label="Candidates" value={`${candidates.length}`} />
          </div>
        </header>

        <div className="evt-layout">
          {/* LEFT */}
          <div className="evt-left">
            <EventChart
              candidates={candidates}
              colorById={colorById}
              hidden={hidden}
              onToggle={toggleLine}
              range={range}
              onRange={setRange}
              ranges={RANGES}
            />

            <section className="evt-card cands">
              <div className="cands-head">
                <h3>{exclusive ? "Candidates" : "Outcomes"}</h3>
                <span className="muted">
                  {exclusive ? "Share of 100%" : "Independent odds"}
                </span>
              </div>
              <div className="cands-cols">
                <span />
                <span className="col-bar" />
                <span className="col-spark" />
                <span className="col-chance">Chance</span>
                <span />
              </div>
              <div className="cands-list">
                {ranked.map((r, i) => (
                  <CandRow
                    key={r.cand.id}
                    cand={r.cand}
                    rank={i + 1}
                    normPct={r.normPct}
                    color={colorById.get(r.cand.id)!}
                    live={liveIds.has(r.cand.id)}
                    selected={r.cand.id === selected.id}
                    onTick={onTick}
                    onSelect={(s) => selectCand(r.cand.id, s)}
                    tradeLabel={t("group.buy")}
                  />
                ))}
              </div>
            </section>

            {/* tabstrip */}
            <section className="evt-card">
              <div className="evt-tabs">
                <button
                  className={tab === "overview" ? "on" : ""}
                  onClick={() => setTab("overview")}
                >
                  Overview
                </button>
                <button
                  className={tab === "activity" ? "on" : ""}
                  onClick={() => setTab("activity")}
                >
                  {t("market.recentTrades")}
                </button>
                <button
                  className={tab === "comments" ? "on" : ""}
                  onClick={() => setTab("comments")}
                >
                  {t("market.discussion")}
                </button>
              </div>

              <div className="evt-pane">
                {tab === "overview" && (
                  <div className="evt-overview">
                    {description ? (
                      <p className="evt-desc">{description}</p>
                    ) : (
                      <p className="evt-desc muted">No description provided.</p>
                    )}
                    <div className="factlist">
                      <Fact
                        k="Type"
                        v={exclusive ? "Winner-takes-all (exclusive)" : "Independent outcomes"}
                      />
                      <Fact k="Candidates" v={`${candidates.length}`} />
                      <Fact k={t("market.volume")} v={`${fmtCoins(totalVolume)} ${t("toast.coins")}`} />
                      <Fact
                        k={t("market.liquidity")}
                        v={`${fmtCoins(totalLiquidity)} ${t("market.shares")}`}
                      />
                      {resolvesAt && (
                        <Fact
                          k="Resolves"
                          v={new Date(resolvesAt).toLocaleString(locale)}
                        />
                      )}
                    </div>
                  </div>
                )}

                {tab === "activity" && (
                  <div className="evt-activity">
                    {trades.length === 0 ? (
                      <div className="muted pad">{t("market.noTrades")}</div>
                    ) : (
                      trades.map((tr) => (
                        <Link
                          key={tr.id}
                          href={lp(`/markets/${tr.marketSlug}`)}
                          className="act-row"
                        >
                          <span className={`act-side ${tr.outcome === "YES" ? "y" : "n"}`}>
                            {tr.outcome}
                          </span>
                          <span className="act-user">@{tr.username}</span>
                          <span className="act-mkt">{tr.marketTitle}</span>
                          <span className="act-amt">
                            {fmtCoins(Math.abs(tr.cost))}
                          </span>
                          <span className="act-time">{timeAgoShort(tr.at)}</span>
                        </Link>
                      ))
                    )}
                  </div>
                )}

                {tab === "comments" && (
                  <Comments
                    marketId={selected.id}
                    canPost={authed}
                    initialData={{
                      comments: initialComments?.[selected.id] ?? [],
                    }}
                  />
                )}
              </div>
            </section>
          </div>

          {/* RIGHT rail — trade ticket */}
          <aside className="evt-rail">
            <div
              className={`ticket${blinkClass}`}
              ref={ticketRef}
            >
              <div className="picked">
                <span
                  className="pick-avatar"
                  style={{
                    background: `linear-gradient(135deg, ${colorById.get(selected.id)}, #0e1428)`,
                  }}
                >
                  {initials(selected.title)}
                </span>
                <div className="pick-name">{selected.title}</div>
                <span className="pick-pct" style={{ color: colorById.get(selected.id) }}>
                  {pctToDec(yesCents)}
                </span>
              </div>

              {/* Outcome picker — change the candidate without scrolling back
                  up to the list. Essential on mobile, where the list and the
                  ticket are stacked and switching outcomes would otherwise
                  mean scrolling up and down repeatedly. */}
              <label className="pick-switch">
                <span className="pick-switch-lbl">{t("group.switchOutcome")}</span>
                <select
                  className="pick-select"
                  value={selected.id}
                  onChange={(e) => selectCand(e.target.value)}
                  aria-label={t("group.switchOutcome")}
                >
                  {ranked.map((r) => (
                    <option key={r.cand.id} value={r.cand.id}>
                      {r.cand.title} · {Math.round(r.live * 100)}%
                    </option>
                  ))}
                </select>
              </label>

              <div className="side-switch">
                <button
                  className={side === "y" ? "on y" : ""}
                  onClick={() => setSide("y")}
                >
                  {t("market.yes")} · {pctToDec(yesCents)}
                </button>
                <button
                  className={side === "n" ? "on n" : ""}
                  onClick={() => setSide("n")}
                >
                  {t("market.no")} · {pctToDec(100 - yesCents)}
                </button>
              </div>

              <label className="field">
                <span>Shares</span>
                <div className="field-input">
                  <button
                    className="field-step"
                    onClick={() => setQty((q) => Math.max(0, q - 50))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={qty}
                    onChange={(e) =>
                      setQty(Math.max(0, parseInt(e.target.value, 10) || 0))
                    }
                  />
                  <button className="field-step" onClick={() => setQty((q) => q + 50)}>
                    +
                  </button>
                </div>
              </label>

              <div className="quick">
                {[100, 500, 1000].map((v) => (
                  <button key={v} onClick={() => setQty((q) => q + v)}>
                    +{v >= 1000 ? "1k" : v}
                  </button>
                ))}
                <button onClick={() => setQty(20000)}>Max</button>
              </div>

              <div className="summary">
                <Row k="Avg price" v={pctToDec(px)} />
                <Row k="Cost" v={`${cost.toFixed(2)} ${t("toast.coins")}`} />
                <Row k="Payout if win" v={`${payout.toFixed(2)} ${t("toast.coins")}`} />
                <Row k="Profit" v={`${profit.toFixed(2)} ${t("toast.coins")}`} accent />
              </div>

              <Link
                href={lp(`/markets/${selected.slug}`)}
                className={`place ${side}`}
              >
                {resolved
                  ? "View market"
                  : `${t("group.buy")} ${side === "y" ? t("market.yes") : t("market.no")} · ${selected.title}`}
              </Link>
              <p className="ticket-note">
                Orders are placed on the candidate&apos;s own market page.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <style>{EVT_CSS}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Candidate row (own SSE subscription)
   ───────────────────────────────────────────────────────────── */

function CandRow({
  cand,
  rank,
  normPct,
  color,
  live,
  selected,
  onTick,
  onSelect,
  tradeLabel,
}: {
  cand: EventCandidate;
  rank: number;
  normPct: number;
  color: string;
  live: boolean;
  selected: boolean;
  onTick: (id: string, yesPrice: number) => void;
  onSelect: (side?: "y" | "n") => void;
  tradeLabel: string;
}) {
  const tick = useMarketStream(live ? cand.id : "", cand.yesPrice);
  const yes = tick?.yesPrice ?? cand.yesPrice;
  useEffect(() => {
    onTick(cand.id, yes);
  }, [cand.id, yes, onTick]);

  const yesCents = Math.round(yes * 100);
  const resolved = cand.status === "RESOLVED" || cand.status === "CANCELLED";

  return (
    <div
      className={`cand${selected ? " selected" : ""}${resolved ? " resolved" : ""}`}
      onClick={() => onSelect()}
      style={{ ["--c" as string]: color }}
    >
      <div className="cand-main">
        <span className="cand-rank">{rank}</span>
        <span
          className="cand-avatar"
          style={{ background: `linear-gradient(135deg, ${color}, #0e1428)` }}
        >
          {initials(cand.title)}
        </span>
        <div className="cand-id">
          <div className="cand-name">{cand.title}</div>
          <div className="cand-sub">{fmtCoins(cand.volumeCoins)} vol</div>
        </div>
      </div>

      <div className="cand-bar">
        <span style={{ width: `${normPct}%`, background: color }} />
      </div>

      <Sparkline series={cand.series} color={color} />

      {/* Chance — the live YES price shown as a whole-number percentage. */}
      <div className="cand-chance" style={{ color }}>
        {yesCents}%
      </div>

      {/* Buy focuses the trade ticket (scroll + blink) rather than navigating
          away — the actual order is placed from the ticket. */}
      <button
        type="button"
        className="cand-trade"
        onClick={(e) => {
          e.stopPropagation();
          onSelect("y");
        }}
      >
        {tradeLabel}
      </button>
    </div>
  );
}

function Sparkline({ series, color }: { series: number[]; color: string }) {
  const pts = series.slice(-16);
  if (pts.length < 2) return <div className="cand-spark" />;
  const w = 80;
  const h = 28;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const span = max - min || 1;
  const d = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg className="cand-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} opacity={up ? 1 : 0.65} />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   Multi-line price chart
   ───────────────────────────────────────────────────────────── */

function EventChart({
  candidates,
  colorById,
  hidden,
  onToggle,
  range,
  onRange,
  ranges,
}: {
  candidates: EventCandidate[];
  colorById: Map<string, string>;
  hidden: Record<string, boolean>;
  onToggle: (id: string) => void;
  range: string;
  onRange: (id: string) => void;
  ranges: { id: string; label: string; frac: number }[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cross, setCross] = useState<{ x: number; idx: number } | null>(null);

  const frac = ranges.find((r) => r.id === range)?.frac ?? 1;

  // Slice every series to the chosen range tail (functional range tabs).
  const sliced = useMemo(() => {
    return candidates.map((c) => {
      const n = Math.max(2, Math.round(c.series.length * frac));
      return { id: c.id, series: c.series.slice(-n) };
    });
  }, [candidates, frac]);

  const len = sliced[0]?.series.length ?? 0;
  // Y-axis labels live in an HTML gutter to the left of the plot and X-axis
  // labels in a row below it, so the SVG plot itself uses the full box.
  const padL = 0;
  const padR = 0;
  const xAt = (i: number) =>
    padL + (len > 1 ? (i / (len - 1)) * (CHART_W - padL - padR) : 0);
  const yAt = (v: number) => CHART_H - (v / 100) * CHART_H;

  // Decimal Y-axis ticks (1.00 → 0.00) aligned with the gridlines.
  const yTicks = [100, 75, 50, 25, 0];
  // Evenly-spaced X-axis time labels (each series point is ~1 day apart,
  // newest last) — leftmost is oldest, rightmost is "Now".
  const xLabels = useMemo(() => {
    if (len < 2) return [] as string[];
    const ticks = 5;
    return Array.from({ length: ticks }, (_, k) => {
      const idx = Math.round((k / (ticks - 1)) * (len - 1));
      const daysAgo = len - 1 - idx;
      return daysAgo === 0 ? "Now" : `${daysAgo}d`;
    });
  }, [len]);

  const buildPath = (arr: number[]) =>
    arr
      .map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
      .join(" ");

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el || len < 2) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < 0 || x > r.width) return;
    const idx = Math.max(0, Math.min(len - 1, Math.round((x / r.width) * (len - 1))));
    setCross({ x, idx });
  };

  const activeCands = candidates.filter((c) => !hidden[c.id]);
  const ttRows =
    cross != null
      ? activeCands.map((c) => {
          const s = sliced.find((x) => x.id === c.id);
          const v = s ? s.series[cross.idx] ?? 0 : 0;
          return { id: c.id, name: c.title, color: colorById.get(c.id)!, v };
        })
      : [];

  return (
    <section className="evt-card chart-card">
      <div className="chart-top">
        <h3>Price history</h3>
        <div className="range-tabs">
          {ranges.map((r) => (
            <button
              key={r.id}
              className={r.id === range ? "on" : ""}
              onClick={() => onRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-grid">
        <div className="y-axis">
          {yTicks.map((v) => (
            <span key={v}>{pctToDec(v)}</span>
          ))}
        </div>

        <div
          className="chart-wrap"
          ref={wrapRef}
          onMouseMove={onMove}
          onMouseLeave={() => setCross(null)}
        >
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="chart-svg">
          {[0, 25, 50, 75, 100].map((g) => (
            <line
              key={g}
              x1={padL}
              x2={CHART_W - padR}
              y1={yAt(g)}
              y2={yAt(g)}
              className="grid"
            />
          ))}
          {sliced.map((s) => {
            const c = candidates.find((x) => x.id === s.id)!;
            const isHidden = hidden[s.id];
            return (
              <path
                key={s.id}
                d={buildPath(s.series)}
                fill="none"
                stroke={colorById.get(s.id)!}
                strokeWidth={1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={isHidden ? 0.1 : 1}
              />
            );
          })}
          {sliced.map((s) => {
            if (hidden[s.id]) return null;
            const v = s.series[s.series.length - 1] ?? 0;
            return (
              <circle
                key={s.id}
                cx={xAt(len - 1)}
                cy={yAt(v)}
                r={3.5}
                fill={colorById.get(s.id)!}
              />
            );
          })}
          {cross != null && (
            <line
              x1={(cross.idx / Math.max(1, len - 1)) * (CHART_W - padL - padR) + padL}
              x2={(cross.idx / Math.max(1, len - 1)) * (CHART_W - padL - padR) + padL}
              y1={0}
              y2={CHART_H}
              className="crosshair"
            />
          )}
        </svg>

        {cross != null && ttRows.length > 0 && (
          <div
            className="chart-tt"
            style={
              cross.x < (wrapRef.current?.clientWidth ?? 0) - 180
                ? { left: cross.x + 12 }
                : { right: (wrapRef.current?.clientWidth ?? 0) - cross.x + 12 }
            }
          >
            {ttRows.map((row) => (
              <div className="tt-row" key={row.id}>
                <span className="tt-l" style={{ color: row.color }}>
                  <span className="sw" style={{ background: row.color }} />
                  {row.name}
                </span>
                <span className="tt-v">{pctToDec(row.v)}</span>
              </div>
            ))}
          </div>
          )}
        </div>

        <div className="x-axis">
          {xLabels.map((lbl, i) => (
            <span key={i}>{lbl}</span>
          ))}
        </div>
      </div>

      <div className="legend">
        {candidates.map((c) => (
          <button
            key={c.id}
            className={`legend-item${hidden[c.id] ? " muted" : ""}`}
            style={{ color: colorById.get(c.id) }}
            onClick={() => onToggle(c.id)}
          >
            <span className="sw" style={{ background: colorById.get(c.id) }} />
            <span className="nm">{c.title}</span>
            <span className="pct">{pctToDec(c.series[c.series.length - 1] ?? 0)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Shared chrome — mirrors the approved Wallet v2 topbar + background
   so the event page reads as part of the same product surface.
   ───────────────────────────────────────────────────────────── */

/** Fixed, layered background: animated colour mesh + faint grid + grain.
 *  Lifted verbatim from the Wallet v2 design (styled by wallet-v2.css). */
function BgStack() {
  return (
    <div className="bg-stack" aria-hidden="true">
      <div className="bg-mesh" />
      <div className="bg-grid" />
      <div className="bg-grain" />
    </div>
  );
}

function EventTopbar({
  lp,
  t,
  balance,
  username,
}: {
  lp: (h: string) => string;
  t: (k: string, vars?: Record<string, string | number>) => string;
  balance?: number | null;
  username?: string | null;
}) {
  const initial = (username ?? "?").slice(0, 1).toUpperCase();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        {/* Logo returns to the Kalki hub (different origin) — plain anchor. */}
        <a className="brand" href={hubHomeUrl()} aria-label="Kalki Exchange">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brand-mark"
            src="/kalki-logo.png"
            alt="Kalki Exchange"
            width={34}
            height={34}
          />
        </a>

        <nav className="nav" aria-label="primary">
          <Link href={lp("/markets")}>{t("nav.markets")}</Link>
          <Link className="active" href={lp("/events")}>
            {t("nav.events")}
          </Link>
          <Link href={lp("/portfolio")}>{t("nav.portfolio")}</Link>
          <Link href={lp("/wallet")}>{t("nav.wallet")}</Link>
        </nav>

        <div className="topbar-right">
          {balance != null && (
            <span className="balance-pill">
              <span className="lbl">BAL</span> {fmtCoins(balance)}
            </span>
          )}
          <ThemeSwitch />
          <Link className="deposit-btn" href={lp("/wallet")}>
            + {t("wallet.buyCoins")}
          </Link>
          {username && <div className="avatar">{initial}</div>}
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────
   Small presentational helpers
   ───────────────────────────────────────────────────────────── */

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-item">
      <span className="meta-v">{value}</span>
      <span className="meta-k">{label}</span>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="fact">
      <span className="fact-k">{k}</span>
      <span className="fact-v">{v}</span>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="sum-row">
      <span>{k}</span>
      <strong className={accent ? "accent" : ""}>{v}</strong>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Scoped styles — ported from the Market Detail design, namespaced
   under `.evt` so they never leak into the rest of the app.
   ───────────────────────────────────────────────────────────── */

const EVT_CSS = `
/* Tokens are aliased onto the approved Wallet v2 design variables (defined
   on :root by wallet-v2.css) so the event page inherits the same palette,
   themes (classic/neon/mythic/calm/terminal) and typography automatically. */
.evt {
  --bg: var(--color-bg);
  --surface: var(--color-surface);
  --surface-2: var(--color-surface-2);
  --border: var(--color-divider);
  --border-strong: var(--color-divider-2);
  --text: var(--color-text-primary);
  --dim: var(--color-text-2);
  --faint: var(--color-text-3);
  --cyan: var(--cyan-400);
  --indigo: var(--indigo-500);
  --yes: var(--emerald-500);
  --no: var(--rose-500);
  --radius: var(--radius-lg);
  font-family: var(--font-sans);
}
.evt .evt-wrap { position: relative; z-index: 1; max-width: 1320px; margin: 0 auto; padding: 28px 24px 96px; }
.evt .evt-empty { max-width: 1320px; margin: 40px auto; padding: 40px; text-align: center; color: var(--dim); }

.evt .evt-crumbs { display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); margin-bottom: 14px; flex-wrap: wrap; }
.evt .evt-crumbs a:hover { color: var(--cyan); }
.evt .evt-crumbs .cur { color: var(--cyan); }

.evt .evt-head { margin-bottom: 18px; }
.evt .evt-head .tags { display: flex; gap: 6px; margin-bottom: 10px; }
.evt .tag { font-family: var(--font-mono); font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .12em; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--border-strong); color: var(--dim); }
.evt .tag.warn { color: var(--amber-300); border-color: rgba(251,191,36,.4); }
.evt .evt-title { font-family: var(--font-display); font-size: 36px; line-height: 1.04; font-weight: 600; letter-spacing: -0.035em; }
.evt .evt-meta { display: flex; gap: 28px; margin-top: 16px; flex-wrap: wrap; }
.evt .meta-item { display: flex; flex-direction: column; gap: 2px; }
.evt .meta-v { font-family: var(--font-mono); font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.evt .meta-k { font-family: var(--font-mono); font-size: 10px; color: var(--faint); text-transform: uppercase; letter-spacing: .12em; }

.evt .evt-layout { display: grid; grid-template-columns: minmax(0,1fr) 360px; gap: 16px; align-items: start; }
@media (max-width: 1080px) { .evt .evt-layout { grid-template-columns: 1fr; } }
.evt .evt-left { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.evt .evt-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }

.evt .chart-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.evt .chart-top h3 { font-family: var(--font-display); font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.evt .range-tabs { display: flex; gap: 4px; }
.evt .range-tabs button { font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 8px; color: var(--faint); border: 1px solid transparent; }
.evt .range-tabs button:hover { color: var(--text); }
.evt .range-tabs button.on { background: var(--surface-2); color: var(--cyan); border-color: var(--border); }

.evt .chart-grid { display: grid; grid-template-columns: 44px minmax(0,1fr); grid-template-rows: 280px auto; }
.evt .y-axis { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; padding-right: 8px; font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; }
.evt .x-axis { grid-column: 2; grid-row: 2; display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; }
.evt .chart-wrap { grid-column: 2; grid-row: 1; position: relative; width: 100%; height: 280px; }
.evt .chart-svg { width: 100%; height: 100%; overflow: visible; }
.evt .chart-svg .grid { stroke: rgba(148,163,184,.08); stroke-width: 1; }
.evt .chart-svg .crosshair { stroke: rgba(148,163,184,.4); stroke-width: 1; stroke-dasharray: 3 3; }
.evt .chart-tt { position: absolute; top: 8px; background: rgba(10,14,22,.95); border: 1px solid var(--border-strong); border-radius: 10px; padding: 8px 10px; pointer-events: none; min-width: 150px; backdrop-filter: blur(8px); z-index: 5; }
.evt .tt-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 12px; padding: 2px 0; }
.evt .tt-l { display: flex; align-items: center; gap: 6px; }
.evt .tt-v { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--text); }
.evt .sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }

.evt .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.evt .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--border); }
.evt .legend-item .nm { color: var(--text); }
.evt .legend-item .pct { font-variant-numeric: tabular-nums; color: var(--dim); }
.evt .legend-item.muted { opacity: .4; }

.evt .cands-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.evt .cands-head h3 { font-family: var(--font-display); font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.evt .muted { color: var(--faint); font-size: 12px; }
.evt .cands-cols { display: grid; grid-template-columns: minmax(0,1fr) 90px 80px 104px 64px; gap: 12px; padding: 0 10px 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .12em; color: var(--faint); }
.evt .cands-cols .col-chance { text-align: center; }
@media (max-width: 720px) { .evt .cands-cols { grid-template-columns: minmax(0,1fr) 104px 64px; } .evt .cands-cols .col-bar, .evt .cands-cols .col-spark { display: none; } }
.evt .cands-list { display: flex; flex-direction: column; }

.evt .cand { display: grid; grid-template-columns: minmax(0,1fr) 90px 80px 104px 64px; align-items: center; gap: 12px; padding: 12px 10px; border-radius: 12px; cursor: pointer; border: 1px solid transparent; transition: background .15s, border-color .15s; }
.evt .cand:hover { background: rgba(148,163,184,.05); }
.evt .cand.selected { background: rgba(34,211,238,.06); border-color: rgba(34,211,238,.3); }
.evt .cand.resolved { opacity: .55; }
@media (max-width: 720px) { .evt .cand { grid-template-columns: minmax(0,1fr) 104px 64px; } .evt .cand-bar, .evt .cand-spark { display: none; } }

.evt .cand-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.evt .cand-rank { width: 16px; font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
.evt .cand-avatar { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0; }
.evt .cand-id { min-width: 0; }
.evt .cand-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evt .cand-sub { font-size: 11px; color: var(--faint); }
.evt .cand-bar { height: 6px; border-radius: 999px; background: rgba(148,163,184,.12); overflow: hidden; }
.evt .cand-bar span { display: block; height: 100%; border-radius: 999px; }
.evt .cand-spark { width: 80px; height: 28px; }

.evt .cand-chance { text-align: center; font-family: var(--font-mono); font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.evt .cand-trade { font-size: 12px; font-weight: 700; padding: 8px 12px; border-radius: 9px; text-align: center; background: linear-gradient(135deg, var(--cyan), var(--indigo)); color: #06121a; cursor: pointer; }
.evt .cand-trade:hover { filter: brightness(1.08); }

.evt .evt-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin: -16px -16px 14px; padding: 4px 12px 0; overflow-x: auto; }
.evt .evt-tabs button { font-size: 13px; font-weight: 600; padding: 10px 12px; color: var(--dim); border-bottom: 2px solid transparent; white-space: nowrap; }
.evt .evt-tabs button:hover { color: var(--text); }
.evt .evt-tabs button.on { color: var(--cyan); border-bottom-color: var(--cyan); }

.evt .evt-desc { font-size: 14px; line-height: 1.6; color: var(--text); white-space: pre-line; max-width: 70ch; }
.evt .factlist { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin-top: 16px; background: var(--border); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
@media (max-width: 560px) { .evt .factlist { grid-template-columns: 1fr; } }
.evt .fact { background: var(--surface); padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; }
.evt .fact-k { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: .04em; }
.evt .fact-v { font-size: 14px; font-weight: 600; }

.evt .evt-activity { display: flex; flex-direction: column; }
.evt .pad { padding: 24px 0; text-align: center; }
.evt .act-row { display: grid; grid-template-columns: 44px 1fr auto auto; align-items: center; gap: 12px; padding: 10px 8px; border-radius: 10px; font-size: 13px; }
.evt .act-row:hover { background: rgba(148,163,184,.05); }
.evt .act-side { font-size: 10px; font-weight: 800; padding: 3px 0; border-radius: 6px; text-align: center; }
.evt .act-side.y { color: var(--yes); background: rgba(52,211,153,.12); }
.evt .act-side.n { color: var(--no); background: rgba(251,113,133,.12); }
.evt .act-user { color: var(--dim); font-family: ui-monospace, monospace; }
.evt .act-mkt { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evt .act-amt { font-variant-numeric: tabular-nums; font-weight: 600; }
.evt .act-time { color: var(--faint); font-size: 11px; }

.evt .evt-rail { position: sticky; top: calc(var(--topbar-h, 64px) + 16px); }
@media (max-width: 1080px) { .evt .evt-rail { position: static; } }
.evt .ticket { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
/* Two identical keyframes alternated by the JS counter so the pulse restarts
   on every selection — even when the same outcome is re-picked. */
.evt .ticket.blink-a { animation: evtBlinkA 1s cubic-bezier(.4,0,.2,1); }
.evt .ticket.blink-b { animation: evtBlinkB 1s cubic-bezier(.4,0,.2,1); }
@keyframes evtBlinkA {
  0%   { box-shadow: 0 0 0 0 rgba(var(--brand-a-rgb),0); border-color: var(--border); transform: scale(1); }
  18%  { box-shadow: 0 0 0 5px rgba(var(--brand-a-rgb),.45), 0 0 36px -4px rgba(var(--brand-a-rgb),.6); border-color: var(--cyan); transform: scale(1.012); }
  60%  { box-shadow: 0 0 0 4px rgba(var(--brand-a-rgb),.18), 0 0 24px -6px rgba(var(--brand-a-rgb),.35); border-color: var(--cyan); transform: scale(1); }
  100% { box-shadow: 0 0 0 0 rgba(var(--brand-a-rgb),0); border-color: var(--border); transform: scale(1); }
}
@keyframes evtBlinkB {
  0%   { box-shadow: 0 0 0 0 rgba(var(--brand-a-rgb),0); border-color: var(--border); transform: scale(1); }
  18%  { box-shadow: 0 0 0 5px rgba(var(--brand-a-rgb),.45), 0 0 36px -4px rgba(var(--brand-a-rgb),.6); border-color: var(--cyan); transform: scale(1.012); }
  60%  { box-shadow: 0 0 0 4px rgba(var(--brand-a-rgb),.18), 0 0 24px -6px rgba(var(--brand-a-rgb),.35); border-color: var(--cyan); transform: scale(1); }
  100% { box-shadow: 0 0 0 0 rgba(var(--brand-a-rgb),0); border-color: var(--border); transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .evt .ticket.blink-a, .evt .ticket.blink-b { animation: none; }
}
/* Prominent outcome switcher — primary path to change candidate on mobile. */
.evt .pick-switch { display: flex; flex-direction: column; gap: 5px; padding: 10px; border-radius: 12px; background: rgba(var(--brand-a-rgb),.06); border: 1px solid rgba(var(--brand-a-rgb),.2); }
.evt .pick-switch-lbl { font-family: var(--font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .12em; color: var(--cyan); }
.evt .pick-select { width: 100%; min-height: 44px; appearance: none; -webkit-appearance: none; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 10px; color: var(--text); font-family: var(--font-sans); font-size: 14px; font-weight: 600; padding: 11px 36px 11px 12px; cursor: pointer; background-image: linear-gradient(45deg, transparent 50%, var(--cyan) 50%), linear-gradient(135deg, var(--cyan) 50%, transparent 50%); background-position: calc(100% - 18px) 52%, calc(100% - 13px) 52%; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.evt .pick-select:hover { border-color: var(--cyan); }
.evt .pick-select:focus-visible { outline: none; border-color: var(--cyan); }
.evt .picked { display: flex; align-items: center; gap: 10px; }
.evt .pick-avatar { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: #fff; }
.evt .pick-name { flex: 1; font-size: 14px; font-weight: 700; }
.evt .pick-pct { font-family: var(--font-mono); font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.evt .side-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.evt .side-switch button { font-size: 13px; font-weight: 700; padding: 11px 0; border-radius: 10px; border: 1px solid var(--border); color: var(--dim); }
.evt .side-switch button.on.y { background: rgba(52,211,153,.15); border-color: var(--yes); color: var(--yes); }
.evt .side-switch button.on.n { background: rgba(251,113,133,.15); border-color: var(--no); color: var(--no); }
.evt .field { display: flex; flex-direction: column; gap: 6px; }
.evt .field > span { font-size: 12px; color: var(--dim); }
.evt .field-input { display: flex; align-items: center; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.evt .field-input input { flex: 1; background: transparent; border: 0; text-align: center; padding: 10px; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); outline: none; -moz-appearance: textfield; }
.evt .field-input input::-webkit-outer-spin-button, .evt .field-input input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.evt .field-step { width: 40px; align-self: stretch; font-size: 18px; color: var(--dim); background: var(--surface-2); }
.evt .field-step:hover { color: var(--text); }
.evt .quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.evt .quick button { font-size: 12px; font-weight: 600; padding: 8px 0; border-radius: 8px; border: 1px solid var(--border); color: var(--dim); }
.evt .quick button:hover { color: var(--text); border-color: var(--border-strong); }
.evt .summary { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.evt .sum-row { display: flex; justify-content: space-between; font-size: 13px; color: var(--dim); }
.evt .sum-row strong { color: var(--text); font-variant-numeric: tabular-nums; }
.evt .sum-row strong.accent { color: var(--yes); }
.evt .place { display: block; text-align: center; font-size: 14px; font-weight: 800; padding: 13px 0; border-radius: 12px; color: #06121a; }
.evt .place.y { background: linear-gradient(135deg, var(--yes), #10b981); }
.evt .place.n { background: linear-gradient(135deg, var(--no), #ef4444); color: #fff; }
.evt .place:hover { filter: brightness(1.06); }
.evt .ticket-note { font-size: 11px; color: var(--faint); text-align: center; }

/* Keep the primary nav (Markets / Events / Portfolio / Wallet) visible on the
   event page even on narrow screens — the shared wallet chrome hides it ≤720.
   Here it wraps onto its own full-width, horizontally-scrollable row beneath
   the logo + actions, so the links stay reachable without crowding. */
@media (max-width: 720px) {
  .evt .topbar { height: auto; }
  .evt .topbar-inner { flex-wrap: wrap; gap: 10px; padding: 10px 14px; }
  .evt .topbar .brand { order: 1; }
  .evt .topbar .topbar-right { order: 2; margin-left: auto; }
  .evt .topbar .nav { display: flex; order: 3; width: 100%; gap: 4px; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
  .evt .topbar .nav::-webkit-scrollbar { display: none; }
  .evt .topbar .nav a { white-space: nowrap; flex: 0 0 auto; }
}
`;

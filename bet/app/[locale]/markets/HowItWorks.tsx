"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * "How prediction markets work" — 8-step explainer modal, harvested from
 * the Claude Design handoff (kalki/Prediction Markets - How It Works.html).
 * Self-contained: carries its own design tokens via `.hiw-overlay`
 * (see how-it-works.css) and portals to <body>. Opened by a "How it works"
 * button on the markets page.
 */

type Slide = {
  label: string;
  art: string; // verbatim SVG markup from the design
  copy: React.ReactNode;
  final?: boolean;
};

const SLIDES: Slide[] = [
  {
    label: "01",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="A market with YES and NO prices and a 62 percent probability bar">
      <rect x="44" y="22" width="232" height="214" rx="18" fill="var(--surface-2)" stroke="var(--border-strong)"/>
      <rect x="62" y="40" width="76" height="24" rx="12" fill="var(--surface-solid)" stroke="var(--border)"/>
      <text x="100" y="56" text-anchor="middle" class="hiw-dgm-txt" font-size="11" fill="var(--muted)">Weather</text>
      <text x="258" y="56" text-anchor="end" class="hiw-dgm-mono" font-size="11" fill="var(--faint)">Closes Tue</text>
      <text x="62" y="92" class="hiw-dgm-txt" font-size="14" fill="var(--text)">Will it rain in</text>
      <text x="62" y="112" class="hiw-dgm-txt" font-size="14" fill="var(--text)">Mumbai tomorrow?</text>
      <rect x="62" y="130" width="196" height="12" rx="6" fill="var(--surface-solid)" stroke="var(--border)"/>
      <rect x="62" y="130" width="122" height="12" rx="6" fill="var(--blue)"/>
      <text x="62" y="162" class="hiw-dgm-mono" font-size="12" font-weight="600" fill="var(--blue)">62% YES</text>
      <text x="258" y="162" text-anchor="end" class="hiw-dgm-mono" font-size="11" fill="var(--faint)">high volume</text>
      <rect x="62" y="176" width="92" height="48" rx="12" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="1.6"/>
      <text x="78" y="197" class="hiw-dgm-txt" font-size="12" fill="var(--blue)">YES</text>
      <text x="78" y="216" class="hiw-dgm-mono" font-size="15" font-weight="600" fill="var(--blue)">0.62</text>
      <rect x="166" y="176" width="92" height="48" rx="12" fill="var(--card)" stroke="var(--border)"/>
      <text x="182" y="197" class="hiw-dgm-txt" font-size="12" fill="var(--muted)">NO</text>
      <text x="182" y="216" class="hiw-dgm-mono" font-size="15" font-weight="600" fill="var(--muted)">0.38</text>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M3 17l5-5 4 4 8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          The big idea
        </span>
        <h2>How prediction markets work</h2>
        <p className="lede">Trade on the outcome of <b>real-world events</b>. Each market&apos;s price reflects the crowd&apos;s live estimate of how likely it is to happen.</p>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <span>&ldquo;Will it rain in Mumbai tomorrow?&rdquo; — YES trades at <b>0.62</b>. The price <b>is</b> the market&apos;s odds: a <b>62%</b> chance.</span>
        </div>
      </>
    ),
  },
  {
    label: "02",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Every market has a YES side and a NO side, each paying ten rupees if correct">
      <rect x="36" y="40" width="108" height="206" rx="16" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="1.6"/>
      <text x="90" y="70" text-anchor="middle" class="hiw-dgm-txt" font-size="17" fill="var(--blue)">YES</text>
      <text x="90" y="88" text-anchor="middle" class="hiw-dgm-txt" font-size="10" fill="var(--muted)">it happens</text>
      <rect x="60" y="104" width="60" height="20" rx="6" fill="var(--surface-solid)" stroke="var(--blue)"/>
      <text x="90" y="118" text-anchor="middle" class="hiw-dgm-mono" font-size="9" fill="var(--blue)">1 share</text>
      <rect x="60" y="130" width="60" height="20" rx="6" fill="var(--surface-solid)" stroke="var(--blue)" opacity="0.7"/>
      <rect x="60" y="156" width="60" height="20" rx="6" fill="var(--surface-solid)" stroke="var(--blue)" opacity="0.45"/>
      <rect x="52" y="206" width="76" height="28" rx="9" fill="var(--surface-solid)" stroke="var(--border)"/>
      <text x="90" y="225" text-anchor="middle" class="hiw-dgm-mono" font-size="11" font-weight="600" fill="var(--blue)">Pays 1.00</text>
      <rect x="176" y="40" width="108" height="206" rx="16" fill="var(--card)" stroke="var(--border)"/>
      <text x="230" y="70" text-anchor="middle" class="hiw-dgm-txt" font-size="17" fill="var(--text)">NO</text>
      <text x="230" y="88" text-anchor="middle" class="hiw-dgm-txt" font-size="10" fill="var(--muted)">it doesn't</text>
      <rect x="200" y="104" width="60" height="20" rx="6" fill="var(--surface-solid)" stroke="var(--border-strong)"/>
      <rect x="200" y="130" width="60" height="20" rx="6" fill="var(--surface-solid)" stroke="var(--border)"/>
      <rect x="200" y="156" width="60" height="20" rx="6" fill="var(--surface-solid)" stroke="var(--border)"/>
      <rect x="192" y="206" width="76" height="28" rx="9" fill="var(--surface-solid)" stroke="var(--border)"/>
      <text x="230" y="225" text-anchor="middle" class="hiw-dgm-mono" font-size="11" font-weight="600" fill="var(--muted)">Pays 1.00</text>
      <circle cx="160" cy="143" r="17" fill="var(--surface-solid)" stroke="var(--border-strong)"/>
      <text x="160" y="148" text-anchor="middle" class="hiw-dgm-txt" font-size="12" fill="var(--faint)">vs</text>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M7 7h11l-3.5-3.5M17 17H6l3.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Two sides
        </span>
        <h2>Every market has a YES and a NO</h2>
        <ol className="steps-list">
          <li><span className="n">1</span><span className="tx">Pick a market — a clear real-world question.</span></li>
          <li><span className="n">2</span><span className="tx">Choose the side you believe in: YES or NO.</span></li>
          <li><span className="n">3</span><span className="tx">Buy shares at the current market price.</span></li>
        </ol>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M7 8h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>A winning share pays out <b>1.00</b> — and 0 if you&apos;re not right.</span>
        </div>
      </>
    ),
  },
  {
    label: "03",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="A price of six rupees twenty on a zero to ten scale equals a sixty-two percent probability">
      <rect x="40" y="150" width="240" height="12" rx="6" fill="var(--surface-2)" stroke="var(--border)"/>
      <rect x="40" y="150" width="149" height="12" rx="6" fill="var(--blue)"/>
      <text x="40" y="184" class="hiw-dgm-mono" font-size="11" fill="var(--faint)">0.00</text>
      <text x="280" y="184" text-anchor="end" class="hiw-dgm-mono" font-size="11" fill="var(--faint)">1.00</text>
      <rect x="183" y="138" width="12" height="36" rx="6" fill="var(--cyan)"/>
      <rect x="151" y="96" width="76" height="32" rx="9" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="1.4"/>
      <text x="189" y="117" text-anchor="middle" class="hiw-dgm-mono" font-size="14" font-weight="600" fill="var(--blue)">0.62</text>
      <path d="M183 128 l6 8 l6 -8" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="1.4" stroke-linejoin="round"/>
      <text x="189" y="212" text-anchor="middle" class="hiw-dgm-txt" font-size="14" fill="var(--blue)">= 62% chance</text>
      <text x="160" y="256" text-anchor="middle" class="hiw-dgm-mono" font-size="12" fill="var(--muted)">YES 0.62 + NO 0.38 = 1.00</text>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M5 19L19 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="2" /><circle cx="16.5" cy="16.5" r="2.5" stroke="currentColor" strokeWidth="2" /></svg>
          Price = probability
        </span>
        <h2>The price is the forecast</h2>
        <p className="lede">A YES price of <b>0.62</b> means the market sees a <b>62% chance</b>. Prices sit between 0 and 1.00, and YES + NO always add up to 1.00.</p>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M3 17l6-6 4 4 8-9M21 6v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>As new information arrives, the price moves — and the implied probability moves with it.</span>
        </div>
      </>
    ),
  },
  {
    label: "04",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Price rising from four rupees to seven rupees, with buy and sell points">
      <line x1="48" y1="64" x2="272" y2="64" stroke="var(--border-strong)" stroke-width="1.5" stroke-dasharray="4 5"/>
      <text x="272" y="56" text-anchor="end" class="hiw-dgm-mono" font-size="10" fill="var(--faint)">1.00 · resolves YES</text>
      <line x1="48" y1="232" x2="272" y2="232" stroke="var(--border)" stroke-width="1.5"/>
      <path d="M64 200 L112 184 L152 150 L196 126 L252 96 L252 232 L64 232 Z" fill="var(--accent-tint)" opacity="0.55"/>
      <path d="M64 200 L112 184 L152 150 L196 126 L252 96" fill="none" stroke="var(--blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="64" cy="200" r="7" fill="var(--surface-solid)" stroke="var(--blue)" stroke-width="3"/>
      <text x="64" y="224" text-anchor="middle" class="hiw-dgm-mono" font-size="11" font-weight="600" fill="var(--text)">Buy 0.40</text>
      <circle cx="252" cy="96" r="7" fill="var(--cyan)"/>
      <text x="252" y="86" text-anchor="end" class="hiw-dgm-mono" font-size="11" font-weight="600" fill="var(--cyan)">Sell 0.70</text>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M3 17l6-6 4 4 8-9M21 6v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Making a return
        </span>
        <h2>Two ways to profit</h2>
        <p className="lede">Buy low and <b>sell higher</b> as the odds shift — or <b>hold to resolution</b> and collect the full 1.00 for each winning share.</p>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          <span>Buy YES at 0.40, news moves it to 0.70 — <b>sell for a gain</b>, or hold for the full 1.00 if it happens.</span>
        </div>
      </>
    ),
  },
  {
    label: "05",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Buying ten shares at five rupees fifty resolves to one hundred rupees, a forty-five rupee profit">
      <rect x="50" y="22" width="220" height="256" rx="16" fill="var(--surface-2)" stroke="var(--border-strong)"/>
      <text x="70" y="58" class="hiw-dgm-txt" font-size="13" fill="var(--muted)">Buy YES at</text>
      <text x="250" y="58" text-anchor="end" class="hiw-dgm-mono" font-size="14" font-weight="600" fill="var(--text)">0.55</text>
      <line x1="70" y1="74" x2="250" y2="74" stroke="var(--border)" stroke-dasharray="3 4"/>
      <rect x="70" y="88" width="134" height="28" rx="14" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="1.4"/>
      <g transform="translate(82,95)"><circle cx="7" cy="7" r="8" fill="var(--blue)"/><path d="M3 7l3 3 5-6" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
      <text x="102" y="107" class="hiw-dgm-txt" font-size="12" fill="var(--blue)">Resolves YES</text>
      <text x="70" y="152" class="hiw-dgm-txt" font-size="13" fill="var(--muted)">Pays out</text>
      <text x="250" y="152" text-anchor="end" class="hiw-dgm-mono" font-size="14" font-weight="600" fill="var(--text)">1.00</text>
      <line x1="70" y1="170" x2="250" y2="170" stroke="var(--border)"/>
      <text x="70" y="206" class="hiw-dgm-txt" font-size="16" fill="var(--text)">Gain</text>
      <text x="250" y="208" text-anchor="end" class="hiw-dgm-mono" font-size="20" font-weight="600" fill="var(--ok)">+0.45</text>
      <text x="160" y="252" text-anchor="middle" class="hiw-dgm-mono" font-size="10" fill="var(--faint)">If it resolved NO: worth 0</text>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Worked example
        </span>
        <h2>A trade, end to end</h2>
        <p className="lede">You buy <b>YES</b> in &ldquo;Will India win the series?&rdquo; at <b>0.55</b>. It resolves YES, so it pays out the full 1.00.</p>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span><b>1.00 − 0.55 = a 0.45 gain per share</b>. Had it resolved NO, it would be worth 0.</span>
        </div>
      </>
    ),
  },
  {
    label: "06",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="A market price chart reacting to news, with trading volume below">
      <line x1="40" y1="196" x2="288" y2="196" stroke="var(--border)" stroke-width="1.5"/>
      <line x1="176" y1="46" x2="176" y2="196" stroke="var(--cyan)" stroke-width="1.6" stroke-dasharray="3 4"/>
      <text x="176" y="40" text-anchor="middle" class="hiw-dgm-mono" font-size="10" fill="var(--cyan)">news</text>
      <path d="M48 150 L84 142 L120 150 L156 132 L176 128 L196 92 L232 96 L268 74" fill="none" stroke="var(--blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="268" cy="74" r="5" fill="var(--blue)"/>
      <g fill="var(--faint)" opacity="0.5">
        <rect x="48" y="178" width="10" height="14" rx="2"/>
        <rect x="84" y="172" width="10" height="20" rx="2"/>
        <rect x="120" y="182" width="10" height="10" rx="2"/>
        <rect x="156" y="168" width="10" height="24" rx="2"/>
      </g>
      <g fill="var(--cyan)" opacity="0.6">
        <rect x="192" y="160" width="10" height="32" rx="2"/>
        <rect x="228" y="170" width="10" height="22" rx="2"/>
        <rect x="264" y="176" width="10" height="16" rx="2"/>
      </g>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M4 19V5M4 19h16M8 16l3-4 3 3 5-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Read the market
        </span>
        <h2>Trade with an edge</h2>
        <ul className="tips">
          <li><span className="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Prices move with news — watch for fresh information.</li>
          <li><span className="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Higher-volume markets give tighter, fairer prices.</li>
          <li><span className="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>You can exit any time before the market closes.</li>
          <li><span className="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Only trade questions you genuinely understand.</li>
        </ul>
        <p className="note-soft">Forecasting carries risk — you can lose the amount you stake.</p>
      </>
    ),
  },
  {
    label: "07",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Markets resolve to verifiable outcomes and settle automatically">
      <path d="M160 30 L250 64 V150 c0 56 -40 88 -90 106 c-50 -18 -90 -50 -90 -106 V64 Z" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="2.4"/>
      <path d="M160 42 L238 72 V150 c0 47 -33 75 -78 92 V42 Z" fill="oklch(0.66 0.155 252 / 0.10)"/>
      <path d="M122 150l26 26 50 -58" stroke="var(--cyan)" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <g class="hiw-dgm-mono" font-size="10" fill="var(--faint)">
        <circle cx="62" cy="84" r="3" fill="var(--blue)"/><text x="72" y="88">verifiable</text>
        <circle cx="228" cy="206" r="3" fill="var(--blue)"/><text x="222" y="210" text-anchor="end">automated</text>
      </g>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
          Trust
        </span>
        <h2>Resolution &amp; transparency</h2>
        <ul className="guarantees">
          <li><span className="gi"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Every market settles to a verifiable real-world outcome.</li>
          <li><span className="gi"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h10M4 17h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></span>Resolution sources are fixed before trading opens.</li>
          <li><span className="gi"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" /><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></span>Settlement is automated once the result is known.</li>
          <li><span className="gi"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" /></svg></span>Your funds are held securely until resolution.</li>
        </ul>
      </>
    ),
  },
  {
    label: "08",
    final: true,
    art: "",
    copy: (
      <>
        <div className="badge-ring">
          <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="Ready to start">
            <circle cx="48" cy="48" r="44" fill="var(--accent-tint)" stroke="var(--blue)" strokeWidth="2" />
            <circle cx="48" cy="48" r="30" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeDasharray="4 6" />
            <path d="M40 30 L40 66 L66 48 Z" fill="var(--blue)" />
          </svg>
        </div>
        <span className="kicker" style={{ justifyContent: "center" }}>Your turn</span>
        <h2>Ready to forecast?</h2>
        <p className="lede">Put your read on the world to work — browse open markets and trade your view.</p>
      </>
    ),
  },
];

export function HowItWorks() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const total = SLIDES.length;

  useEffect(() => setMounted(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowRight") setI((v) => Math.min(total - 1, v + 1));
      else if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, total]);

  const openModal = () => {
    setI(0);
    setOpen(true);
  };

  const stepLabel = `${String(i + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;

  return (
    <>
      <button type="button" className="hiw-howbtn" onClick={openModal} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.1.8-1.1 1.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="11.8" cy="16.4" r="1.1" fill="currentColor" /></svg>
        How it works
      </button>

      {mounted &&
        createPortal(
          <div
            className={`hiw-overlay${open ? " open" : ""}`}
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div className="modal" role="dialog" aria-modal="true" aria-label="How prediction markets work">
              <div className="m-head">
                <div className="progress" role="tablist" aria-label="Steps">
                  {SLIDES.map((s, n) => (
                    <button
                      key={s.label}
                      type="button"
                      className={`seg${n === i ? " active" : n < i ? " done" : ""}`}
                      aria-label={`Go to step ${n + 1}`}
                      aria-selected={n === i}
                      role="tab"
                      onClick={() => setI(n)}
                    />
                  ))}
                </div>
                <div className="spacer" />
                <span className="step-label">{stepLabel}</span>
                <button className="icon-btn" onClick={close} aria-label="Close">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                </button>
              </div>

              <div className="viewport">
                <div className="track" style={{ transform: `translateX(-${i * 100}%)` }}>
                  {SLIDES.map((s) => (
                    <section key={s.label} className={`slide${s.final ? " final" : ""}`} aria-roledescription="slide">
                      {s.final ? (
                        <div className="copy">
                          {s.copy}
                          <div className="final-actions">
                            <button type="button" className="btn btn-primary" onClick={close}>
                              Browse markets
                              <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                            <button type="button" className="btn btn-outline" onClick={close}>Got it</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="art" dangerouslySetInnerHTML={{ __html: s.art }} />
                          <div className="copy">{s.copy}</div>
                        </>
                      )}
                    </section>
                  ))}
                </div>
              </div>

              <div className="m-foot">
                <button type="button" className="btn btn-ghost" disabled={i === 0} onClick={() => setI((v) => Math.max(0, v - 1))}>
                  <svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Back
                </button>
                <div className="spacer" />
                <span className="dotcount">Step {i + 1} of {total}</span>
                <div className="spacer" />
                {i < total - 1 ? (
                  <button type="button" className="btn btn-primary" onClick={() => setI((v) => Math.min(total - 1, v + 1))}>
                    {i === total - 2 ? "Finish" : "Next"}
                    <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={close}>Done</button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

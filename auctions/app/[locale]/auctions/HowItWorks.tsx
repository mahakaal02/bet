"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * "How Lowest Unique Bid auctions work" — 8-step explainer modal.
 * Ported from the Claude Design handoff (kalki/project/How It Works.html).
 * Example amounts use the coin glyph (bids are denominated in coins, and
 * we keep no hardcoded fiat symbols). Self-contained: carries its own
 * design tokens via `.hiw-overlay` (see auctions-theme.css) and portals
 * to <body> so it overlays the whole page.
 */

type Slide = {
  label: string;
  /** Verbatim SVG markup from the design (kebab-case attrs, var() colors). */
  art: string;
  copy: React.ReactNode;
  final?: boolean;
};

const SLIDES: Slide[] = [
  {
    label: "01",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Four users place bids; the lowest unique bid wins">
      <rect x="96" y="6" width="128" height="74" rx="14" fill="var(--surface-2)" stroke="var(--border-strong)"/>
      <rect x="110" y="20" width="44" height="46" rx="9" fill="var(--accent-tint)"/>
      <path d="M122 50l8-9 6 7 5-5 7 8" stroke="var(--blue)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="129" cy="34" r="4" fill="var(--cyan)"/>
      <rect x="166" y="26" width="44" height="8" rx="4" fill="var(--muted)" opacity=".55"/>
      <rect x="166" y="42" width="32" height="7" rx="3.5" fill="var(--faint)" opacity=".5"/>
      <text x="166" y="64" class="hiw-dgm-mono" font-size="11" font-weight="600" fill="var(--blue)">Auction</text>
      <g font-size="13">
        <rect x="40" y="104" width="240" height="38" rx="11" fill="var(--card)" stroke="var(--border)"/>
        <circle cx="62" cy="123" r="13" fill="oklch(0.60 0.13 25 / .25)"/><text x="62" y="127" text-anchor="middle" class="hiw-dgm-txt" font-size="11" fill="var(--text)">A</text>
        <text x="86" y="128" class="hiw-dgm-txt" fill="var(--muted)">User A</text>
        <text x="252" y="128" text-anchor="end" class="hiw-dgm-mono" font-weight="600" fill="var(--faint)">5.01</text>
        <line x1="222" y1="123" x2="262" y2="123" stroke="oklch(0.60 0.16 25)" stroke-width="2"/>
        <rect x="40" y="148" width="240" height="40" rx="11" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="1.6"/>
        <circle cx="62" cy="168" r="13" fill="var(--blue)"/><text x="62" y="172" text-anchor="middle" class="hiw-dgm-txt" font-size="11" fill="white">B</text>
        <text x="86" y="173" class="hiw-dgm-txt" fill="var(--text)">User B</text>
        <text x="252" y="173" text-anchor="end" class="hiw-dgm-mono" font-weight="600" fill="var(--blue)">5.02</text>
        <g transform="translate(176,160)"><path d="M2 12l2-7 4 4 4-7 4 7 4-4 2 7z" fill="var(--cyan)"/></g>
        <rect x="40" y="194" width="240" height="38" rx="11" fill="var(--card)" stroke="var(--border)"/>
        <circle cx="62" cy="213" r="13" fill="oklch(0.60 0.13 25 / .25)"/><text x="62" y="217" text-anchor="middle" class="hiw-dgm-txt" font-size="11" fill="var(--text)">C</text>
        <text x="86" y="218" class="hiw-dgm-txt" fill="var(--muted)">User C</text>
        <text x="252" y="218" text-anchor="end" class="hiw-dgm-mono" font-weight="600" fill="var(--faint)">5.01</text>
        <line x1="222" y1="213" x2="262" y2="213" stroke="oklch(0.60 0.16 25)" stroke-width="2"/>
        <rect x="40" y="238" width="240" height="38" rx="11" fill="var(--card)" stroke="var(--border)"/>
        <circle cx="62" cy="257" r="13" fill="oklch(0.62 0.10 250 / .25)"/><text x="62" y="261" text-anchor="middle" class="hiw-dgm-txt" font-size="11" fill="var(--text)">D</text>
        <text x="86" y="262" class="hiw-dgm-txt" fill="var(--muted)">User D</text>
        <text x="252" y="262" text-anchor="end" class="hiw-dgm-mono" font-weight="600" fill="var(--muted)">5.03</text>
      </g>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M3 17l5-5 4 4 8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          The big idea
        </span>
        <h2>How Lowest Unique Bid auctions work</h2>
        <p className="lede">Instead of bidding the <b>highest</b> amount, the winner is the participant who places the <b>lowest bid that nobody else has chosen</b>.</p>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <span>5.01 was picked by both A and C, so it&apos;s out. <b>User B wins at 5.02</b> — the lowest amount only one person chose.</span>
        </div>
      </>
    ),
  },
  {
    label: "02",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Selecting an item and entering a bid amount">
      <rect x="46" y="22" width="228" height="256" rx="18" fill="var(--surface-2)" stroke="var(--border-strong)"/>
      <rect x="66" y="42" width="60" height="60" rx="12" fill="var(--accent-tint)"/>
      <path d="M82 84l9-11 6 8 5-6 8 9" stroke="var(--blue)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="90" cy="60" r="5" fill="var(--cyan)"/>
      <rect x="140" y="50" width="108" height="9" rx="4.5" fill="var(--muted)" opacity=".6"/>
      <rect x="140" y="68" width="76" height="8" rx="4" fill="var(--faint)" opacity=".55"/>
      <text x="140" y="98" class="hiw-dgm-mono" font-size="11" font-weight="600" fill="var(--faint)">Retail value</text>
      <text x="66" y="138" class="hiw-dgm-txt" font-size="12" fill="var(--muted)">Your bid</text>
      <rect x="66" y="148" width="188" height="48" rx="12" fill="var(--surface-solid)" stroke="var(--blue)" stroke-width="1.6"/>
      <text x="82" y="179" class="hiw-dgm-mono" font-size="22" font-weight="600" fill="var(--text)">12.47</text>
      <rect x="214" y="158" width="2" height="28" rx="1" fill="var(--blue)"><animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite"/></rect>
      <rect x="66" y="212" width="188" height="46" rx="12" fill="var(--blue)"/>
      <text x="160" y="241" text-anchor="middle" class="hiw-dgm-txt" font-size="14" fill="white">Submit bid</text>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h10M4 17h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          Placing a bid
        </span>
        <h2>Choose your bid in three steps</h2>
        <ol className="steps-list">
          <li><span className="n">1</span><span className="tx">Select an auction item you want to win.</span></li>
          <li><span className="n">2</span><span className="tx">Enter your bid amount — down to two decimals.</span></li>
          <li><span className="n">3</span><span className="tx">Submit your bid to enter the round.</span></li>
        </ol>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          <span>Thousands of bids may be submitted — but only <b>unique</b> bids can win.</span>
        </div>
      </>
    ),
  },
  {
    label: "03",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Table of bids and counts; bids chosen once are unique">
      <rect x="40" y="20" width="240" height="34" rx="9" fill="var(--surface-2)" stroke="var(--border)"/>
      <text x="60" y="42" class="hiw-dgm-txt" font-size="12" fill="var(--muted)">Bid</text>
      <text x="260" y="42" text-anchor="end" class="hiw-dgm-txt" font-size="12" fill="var(--muted)">Times chosen</text>
      <g class="hiw-dgm-mono" font-size="14" font-weight="600">
        <rect x="40" y="60" width="240" height="42" rx="10" fill="var(--card)" stroke="var(--border)"/>
        <text x="60" y="86" fill="var(--faint)">1.01</text>
        <g transform="translate(210,74)"><circle cx="0" cy="0" r="5" fill="var(--faint)"/><circle cx="14" cy="0" r="5" fill="var(--faint)"/><circle cx="28" cy="0" r="5" fill="var(--faint)"/></g>
        <text x="262" y="79" text-anchor="end" font-size="11" fill="var(--faint)" class="hiw-dgm-mono">×3</text>
        <rect x="40" y="108" width="240" height="44" rx="10" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="1.6"/>
        <text x="60" y="135" fill="var(--blue)">1.02</text>
        <circle cx="216" cy="130" r="5" fill="var(--blue)"/>
        <g transform="translate(238,123)"><circle cx="7" cy="7" r="10" fill="var(--blue)"/><path d="M3 7l3 3 5-6" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
        <rect x="40" y="158" width="240" height="42" rx="10" fill="var(--card)" stroke="var(--border)"/>
        <text x="60" y="184" fill="var(--faint)">1.03</text>
        <g transform="translate(216,172)"><circle cx="0" cy="0" r="5" fill="var(--faint)"/><circle cx="14" cy="0" r="5" fill="var(--faint)"/></g>
        <text x="262" y="177" text-anchor="end" font-size="11" fill="var(--faint)" class="hiw-dgm-mono">×2</text>
        <rect x="40" y="206" width="240" height="44" rx="10" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="1.6"/>
        <text x="60" y="233" fill="var(--blue)">1.04</text>
        <circle cx="216" cy="228" r="5" fill="var(--blue)"/>
        <g transform="translate(238,221)"><circle cx="7" cy="7" r="10" fill="var(--blue)"/><path d="M3 7l3 3 5-6" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
      </g>
      <text x="40" y="280" class="hiw-dgm-mono" font-size="11" fill="var(--blue)">Unique = chosen exactly once</text>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" /><rect x="14" y="3" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" /><rect x="3" y="14" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" /><rect x="14" y="14" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" /></svg>
          Definition
        </span>
        <h2>What makes a bid unique?</h2>
        <p className="lede">A bid is unique only when <b>no other participant has selected the exact same amount</b>.</p>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>In this round only <b>1.02</b> and <b>1.04</b> are unique — each was chosen by a single person.</span>
        </div>
      </>
    ),
  },
  {
    label: "04",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Scanning bids from lowest to highest to find the first unique one">
      <text x="40" y="22" class="hiw-dgm-mono" font-size="11" fill="var(--faint)">LOW</text>
      <text x="280" y="278" text-anchor="end" class="hiw-dgm-mono" font-size="11" fill="var(--faint)">HIGH</text>
      <line x1="26" y1="30" x2="26" y2="270" stroke="var(--border-strong)" stroke-width="2"/>
      <path d="M26 270l-4-8h8z" fill="var(--border-strong)"/>
      <g class="hiw-dgm-mono" font-size="14" font-weight="600">
        <rect x="48" y="34" width="232" height="44" rx="11" fill="var(--card)" stroke="var(--border)"/>
        <text x="68" y="61" fill="var(--faint)">1.01</text>
        <g transform="translate(214,46)"><circle cx="10" cy="10" r="11" fill="oklch(0.60 0.16 25 / .2)"/><path d="M6 6l8 8M14 6l-8 8" stroke="oklch(0.62 0.16 25)" stroke-width="2" stroke-linecap="round"/></g>
        <text x="150" y="61" class="hiw-dgm-txt" font-size="11" fill="var(--faint)">Duplicate</text>
        <rect x="48" y="86" width="232" height="48" rx="11" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="2"/>
        <text x="68" y="115" fill="var(--blue)">1.02</text>
        <g transform="translate(212,98)"><circle cx="11" cy="11" r="12" fill="var(--blue)"/><path d="M6 11l3.5 3.5L17 7" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
        <text x="142" y="115" class="hiw-dgm-txt" font-size="11" fill="var(--blue)">Unique winner</text>
        <rect x="48" y="142" width="232" height="44" rx="11" fill="var(--card)" stroke="var(--border)" opacity=".7"/>
        <text x="68" y="169" fill="var(--faint)">1.03</text>
        <g transform="translate(214,154)"><circle cx="10" cy="10" r="11" fill="oklch(0.60 0.16 25 / .2)"/><path d="M6 6l8 8M14 6l-8 8" stroke="oklch(0.62 0.16 25)" stroke-width="2" stroke-linecap="round"/></g>
        <text x="150" y="169" class="hiw-dgm-txt" font-size="11" fill="var(--faint)">Duplicate</text>
        <rect x="48" y="194" width="232" height="44" rx="11" fill="var(--card)" stroke="var(--border)" opacity=".7"/>
        <text x="68" y="221" fill="var(--faint)">1.04</text>
        <g transform="translate(214,206)"><circle cx="10" cy="10" r="11" fill="oklch(0.74 0.14 165 / .2)"/><path d="M5 10l3 3 6-7" stroke="var(--ok)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
        <text x="150" y="221" class="hiw-dgm-txt" font-size="11" fill="var(--faint)">Unique</text>
      </g>
      <path d="M36 38 L36 110" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 6"><animate attributeName="stroke-dashoffset" values="0;-18" dur="0.9s" repeatCount="indefinite"/></path>
      <circle cx="36" cy="110" r="4" fill="var(--cyan)"/>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          The algorithm
        </span>
        <h2>Finding the winner</h2>
        <p className="lede">The system scans bids from <b>lowest to highest</b>. The first bid that appears <b>only once</b> becomes the winning bid.</p>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <span>1.01 is a duplicate, so the scan moves up. <b>1.02 is the first unique bid — and the winner.</b></span>
        </div>
      </>
    ),
  },
  {
    label: "05",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Five participants; Sara wins with the only unique bid">
      <g font-size="13">
        <text x="40" y="34" class="hiw-dgm-mono" font-size="11" fill="var(--faint)">2.11 — picked twice</text>
        <rect x="40" y="42" width="116" height="40" rx="11" fill="var(--card)" stroke="var(--border)"/>
        <circle cx="62" cy="62" r="12" fill="oklch(0.60 0.13 25 / .25)"/><text x="62" y="66" text-anchor="middle" class="hiw-dgm-txt" font-size="10" fill="var(--text)">R</text>
        <text x="82" y="66" class="hiw-dgm-txt" font-size="12" fill="var(--muted)">Rahul</text>
        <rect x="164" y="42" width="116" height="40" rx="11" fill="var(--card)" stroke="var(--border)"/>
        <circle cx="186" cy="62" r="12" fill="oklch(0.60 0.13 25 / .25)"/><text x="186" y="66" text-anchor="middle" class="hiw-dgm-txt" font-size="10" fill="var(--text)">P</text>
        <text x="206" y="66" class="hiw-dgm-txt" font-size="12" fill="var(--muted)">Priya</text>
        <text x="40" y="108" class="hiw-dgm-mono" font-size="11" fill="var(--faint)">2.37 — picked twice</text>
        <rect x="40" y="116" width="116" height="40" rx="11" fill="var(--card)" stroke="var(--border)"/>
        <circle cx="62" cy="136" r="12" fill="oklch(0.60 0.13 25 / .25)"/><text x="62" y="140" text-anchor="middle" class="hiw-dgm-txt" font-size="10" fill="var(--text)">A</text>
        <text x="82" y="140" class="hiw-dgm-txt" font-size="12" fill="var(--muted)">Amit</text>
        <rect x="164" y="116" width="116" height="40" rx="11" fill="var(--card)" stroke="var(--border)"/>
        <circle cx="186" cy="136" r="12" fill="oklch(0.60 0.13 25 / .25)"/><text x="186" y="140" text-anchor="middle" class="hiw-dgm-txt" font-size="10" fill="var(--text)">V</text>
        <text x="206" y="140" class="hiw-dgm-txt" font-size="12" fill="var(--muted)">Vikram</text>
        <text x="40" y="182" class="hiw-dgm-mono" font-size="11" fill="var(--blue)">2.45 — picked once</text>
        <rect x="40" y="190" width="240" height="64" rx="14" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="2"/>
        <circle cx="70" cy="222" r="17" fill="var(--blue)"/><text x="70" y="227" text-anchor="middle" class="hiw-dgm-txt" font-size="13" fill="white">S</text>
        <text x="98" y="216" class="hiw-dgm-txt" font-size="15" fill="var(--text)">Sara</text>
        <text x="98" y="236" class="hiw-dgm-mono" font-size="13" font-weight="600" fill="var(--blue)">2.45</text>
        <g transform="translate(232,206)"><path d="M4 18l-2-13 6 5 5-9 5 9 6-5-2 13z" fill="var(--cyan)"/><rect x="3" y="20" width="20" height="4" rx="2" fill="var(--cyan)"/></g>
        <text x="40" y="278" class="hiw-dgm-txt" font-size="12" fill="var(--ok)">Winner · only unique bid</text>
      </g>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="2" /><circle cx="17" cy="9" r="2.6" stroke="currentColor" strokeWidth="2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 19a5 5 0 0 1 5.5-4.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          Worked example
        </span>
        <h2>A real round, start to finish</h2>
        <p className="lede"><b>2.11</b> and <b>2.37</b> were each chosen by two participants, so both are excluded. <b>2.45</b> was the lowest bid selected by only one person.</p>
        <div className="callout">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span><b>Sara wins at 2.45</b> — not the lowest amount overall, but the lowest <b>unique</b> one.</span>
        </div>
      </>
    ),
  },
  {
    label: "06",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Aim for bids that are both low and unique">
      <circle cx="160" cy="150" r="100" fill="none" stroke="var(--border)" stroke-width="2"/>
      <circle cx="160" cy="150" r="68" fill="none" stroke="var(--border-strong)" stroke-width="2"/>
      <circle cx="160" cy="150" r="38" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="2"/>
      <circle cx="160" cy="150" r="11" fill="var(--blue)"/>
      <g fill="var(--faint)">
        <circle cx="120" cy="120" r="5"/><circle cx="132" cy="132" r="5"/><circle cx="116" cy="138" r="5"/>
        <circle cx="138" cy="116" r="5"/><circle cx="128" cy="148" r="5"/>
      </g>
      <text x="92" y="104" class="hiw-dgm-mono" font-size="10" fill="var(--faint)">crowd</text>
      <g transform="translate(196,118)"><circle cx="0" cy="0" r="7" fill="var(--cyan)"/><path d="M0 0 L34 -30" stroke="var(--cyan)" stroke-width="3" stroke-linecap="round"/><path d="M34 -30 l-9 1 4 8z" fill="var(--cyan)"/></g>
      <text x="204" y="100" class="hiw-dgm-mono" font-size="10" fill="var(--cyan)">you</text>
      <line x1="160" y1="150" x2="196" y2="118" stroke="var(--cyan)" stroke-width="2" stroke-dasharray="2 4"/>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="2" /></svg>
          Play smart
        </span>
        <h2>Strategy tips</h2>
        <ul className="tips">
          <li><span className="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Avoid obvious round numbers — everyone reaches for them.</li>
          <li><span className="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Think differently from the rest of the field.</li>
          <li><span className="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Lower isn&apos;t always better if many people pick it.</li>
          <li><span className="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>The goal is to be both <b>low</b> and <b>unique</b>.</li>
        </ul>
        <p className="note-soft">Tips improve your odds — no strategy guarantees a win.</p>
      </>
    ),
  },
  {
    label: "07",
    art: `<svg viewBox="0 0 320 300" role="img" aria-label="Bids are securely recorded and winners selected automatically">
      <path d="M160 30 L250 64 V150 c0 56 -40 88 -90 106 c-50 -18 -90 -50 -90 -106 V64 Z" fill="var(--accent-tint)" stroke="var(--blue)" stroke-width="2.4"/>
      <path d="M160 42 L238 72 V150 c0 47 -33 75 -78 92 V42 Z" fill="oklch(0.66 0.155 252 / 0.10)"/>
      <path d="M122 150l26 26 50 -58" stroke="var(--cyan)" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <g class="hiw-dgm-mono" font-size="10" fill="var(--faint)">
        <circle cx="64" cy="84" r="3" fill="var(--blue)"/><text x="74" y="88">secured</text>
        <circle cx="232" cy="200" r="3" fill="var(--blue)"/><text x="156" y="204">automated</text>
      </g>
    </svg>`,
    copy: (
      <>
        <span className="kicker">
          <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
          Trust
        </span>
        <h2>Fairness &amp; transparency</h2>
        <ul className="guarantees">
          <li><span className="gi"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" /></svg></span>All bids are securely recorded.</li>
          <li><span className="gi"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" /><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></span>Winner selection is fully automated.</li>
          <li><span className="gi"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></span>Duplicate bids are excluded automatically.</li>
          <li><span className="gi"><svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>Results follow predefined, public rules.</li>
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
        <h2>Ready to try?</h2>
        <p className="lede">Use strategy, choose a unique amount, and compete for amazing products.</p>
      </>
    ),
  },
];

export function HowItWorks({ browseHref }: { browseHref: string }) {
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
            <div className="modal" role="dialog" aria-modal="true" aria-label="How Lowest Unique Bid auctions work">
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
                            <a className="btn btn-primary" href={browseHref}>
                              Browse auctions
                              <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </a>
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={i === 0}
                  onClick={() => setI((v) => Math.max(0, v - 1))}
                >
                  <svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Back
                </button>
                <div className="spacer" />
                <span className="dotcount">Step {i + 1} of {total}</span>
                <div className="spacer" />
                {i < total - 1 ? (
                  <button type="button" className="btn btn-primary" onClick={() => setI((v) => Math.min(total - 1, v + 1))}>
                    Next
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

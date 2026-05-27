"use client";

/**
 * Kalki hub landing + login (PR-LOGIN-REDESIGN v2 — cyan/indigo).
 *
 * Single client component for the dark-luxury Gen-Z iGaming landing
 * page. Combines:
 *   • A cinematic hero with a live crash chart that animates
 *     end-to-end (climb → bust → reset) using SVG + requestAnimationFrame.
 *   • A glassmorphism login card on the right (mobile: above the
 *     hero) with Login / Sign-up tabs, Telegram OAuth, and the
 *     existing 2FA flow preserved verbatim from the legacy form.
 *   • Below the fold: a scrolling winner ticker, three market
 *     teaser cards, and a four-cell trust bar.
 *   • Locale-aware text, currency symbol, sample amounts, and
 *     regional winner names. Initial locale is server-resolved
 *     and passed in; user can override via the in-nav switcher,
 *     which writes `kalki_locale` and triggers `router.refresh()`
 *     so the next SSR-ed page picks up the new locale.
 *
 * New behaviour in v2 — "scroll back + highlight":
 *   The three market-card CTAs at the bottom of the page act as
 *   conversion nudges: clicking any of them smooth-scrolls the
 *   viewport back to the login card and adds a `.highlight-pulse`
 *   class for ~2.4s so the user's attention re-lands on the form.
 *   Also auto-switches the auth mode to "signup", because anyone
 *   tapping a market CTA from an unauthenticated state is by
 *   definition a new-user funnel.
 *
 * Auth integration:
 *   • Email/password form posts to `/api/auth/login` (same as the
 *     legacy `LoginForm.tsx`). Honors `needs2FA` → second step at
 *     `/api/auth/login-2fa` with optional `trustDevice`.
 *   • Telegram button redirects to `/api/auth/telegram/start` which
 *     hands off to the Telegram Login Widget bot flow.
 *   • Demo-user chips appear under the submit button when
 *     `demoVisible` is true (dev/QA only — page.tsx wires this
 *     to `NODE_ENV !== 'production'`).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "./landing.css";
import {
  LOCALES,
  STRINGS,
  buildMixedWinners,
  getString,
  type CountryCode,
  type LanguageCode,
  type StringKey,
} from "./locale-data";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/locale-constants";

type AuthMode = "login" | "signup" | "2fa";

export interface LoginLandingProps {
  initialCountry: CountryCode;
  /** Same-origin path to redirect to after a successful sign-in. */
  next: string;
  /** When true, render a row of demo-user chips under the submit
   *  button. Single-click fills the form with one of the seeded
   *  accounts (see backend/prisma/seed.ts). Dev/QA only — the
   *  server only sets this in non-production. */
  demoVisible: boolean;
}

/**
 * Seed accounts created by `backend/prisma/seed.ts` and
 * `bet/prisma/seed.ts`. All four share the password `password12345`.
 * Chip-to-fill helps QA flip between identities while testing
 * real-time bid updates — open one browser as user1, another as
 * user2, watch the "outbid" status flip live.
 */
const SHARED_PASSWORD = "password12345";
const DEMO_USERS: Array<{ email: string; label: string; kind: "player" | "admin" }> = [
  { email: "user1@kalki.local", label: "user1", kind: "player" },
  { email: "user2@kalki.local", label: "user2", kind: "player" },
  { email: "user3@kalki.local", label: "user3", kind: "player" },
  { email: "admin@kalki.local", label: "admin", kind: "admin" },
];

const rand = (a: number, b: number) => Math.random() * (b - a) + a;

function parseSample(s: string): number {
  // Strip everything but digits — keep magnitude regardless of the
  // sample's local digit grouping convention.
  return parseInt(s.replace(/[^\d]/g, ""), 10) || 0;
}

function formatNumber(n: number, numberFmt: string): string {
  try {
    return new Intl.NumberFormat(numberFmt).format(n);
  } catch {
    return n.toLocaleString();
  }
}

/**
 * HTML-template tag for translation strings that contain inline
 * `<b>` / `<span>` markup. We trust the dictionary contents
 * (they're our own source code, not user input).
 */
function htmlString(key: StringKey, lang: LanguageCode): { __html: string } {
  return { __html: getString(key, lang) };
}

export function LoginLanding({
  initialCountry,
  next,
  demoVisible,
}: LoginLandingProps) {
  const router = useRouter();
  const [country, setCountry] = useState<CountryCode>(initialCountry);
  const locale = LOCALES[country];
  const lang = locale.lang;

  const t = useCallback(
    (key: StringKey) => getString(key, lang),
    [lang],
  );

  // ── ticker / toast pool keyed on the active region ─────────────
  const winnersPool = useMemo(() => buildMixedWinners(country), [country]);

  /* ============================================================
     LOCALE SWITCHER
     ============================================================ */
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  const locMenuRef = useRef<HTMLDivElement>(null);
  const locBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!locMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !locMenuRef.current?.contains(target) &&
        !locBtnRef.current?.contains(target)
      ) {
        setLocMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [locMenuOpen]);

  function selectCountry(code: CountryCode) {
    setCountry(code);
    setLocMenuOpen(false);
    // Persist for next visit + tell server to re-resolve on next nav.
    const secure = window.location.protocol === "https:";
    document.cookie = [
      `${LOCALE_COOKIE}=${code}`,
      "path=/",
      `max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`,
      "samesite=lax",
      secure ? "secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
    // No router.refresh — page is rendered client-side from props
    // and the dictionary is full client-side. Saving locally is
    // enough; the cookie is honored on the next visit.
  }

  /* ============================================================
     COUNTERS (paidOut / playersOnline / activePred)
     ------------------------------------------------------------
     `paidOut` is shown DIVIDED BY 100 from the underlying locale
     sample. The sample magnitudes were sized for a hypothetical
     "all-product gross" view that overshot what we actually want
     to advertise (e.g. India's ₹8,42,19,330 = ~₹8.4 crore). One-
     hundredth of that lands in a more believable range (~₹8.4 lakh
     in India, R$ ~218k in Brazil, etc.) without forking the locale
     samples — those are still used elsewhere (crash pot, market
     card "retail value") where the larger magnitudes are correct.

     The ticking increment is similarly scaled — was rand(120, 8400)
     per tick (which would have pushed ₹8.4 crore past ₹9 crore in
     a minute); now rand(1, 84) per tick so the number visibly
     moves but stays in the believable range.
     ============================================================ */
  const [paidOut, setPaidOut] = useState(
    () => Math.floor(parseSample(locale.samples.paidOut) / 100),
  );
  const [playersOnline, setPlayersOnline] = useState(14238);
  const [activePred, setActivePred] = useState(3841);
  const [loginOnline, setLoginOnline] = useState(412);

  // Reset paidOut base whenever the locale changes so the ticking
  // counter starts from a believable per-region magnitude.
  useEffect(() => {
    setPaidOut(Math.floor(parseSample(locale.samples.paidOut) / 100));
  }, [locale.samples.paidOut]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPaidOut((v) => v + Math.floor(rand(1, 84)));
      setPlayersOnline((v) => v + Math.floor(rand(-12, 38)));
      setActivePred((v) => Math.max(3200, v + Math.floor(rand(-4, 8))));
      setLoginOnline(Math.floor(rand(380, 470)));
    }, 1400);
    return () => window.clearInterval(id);
  }, []);

  /* ============================================================
     LAST CRASH — wired to the aviator backend
     ------------------------------------------------------------
     The "Last crash" stat tile in the hero displays the most
     recent CRASHED round's multiplier. Sourced from the public
     endpoint at `/api/aviator/last-crash` (Next.js route handler
     proxying to `${BACKEND}/aviator/public/last-crash`) so the
     landing page — which is unauthenticated — can read it without
     a session.

     Polling cadence: 15s. Aviator rounds last ~5-12s between
     crashes; 15s is the longest interval that still feels live
     while keeping the request rate cheap (~4/min/visitor) and
     well under the server-side throttle (30/min).

     Initial state is `null` rather than a static fallback so the
     UI can render an explicit em-dash when no published round
     exists (fresh DB, pre-launch, or backend down) — accurate
     placeholder beats a hard-coded number that pretends to be
     live data.
     ============================================================ */
  const [lastCrashBackend, setLastCrashBackend] = useState<number | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const res = await fetch("/api/aviator/last-crash", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { multiplier: string | null };
        if (cancelled) return;
        if (body.multiplier === null) {
          setLastCrashBackend(null);
        } else {
          const n = Number(body.multiplier);
          if (Number.isFinite(n)) setLastCrashBackend(n);
        }
      } catch {
        // Network down / backend hiccup — leave the last good value
        // in place. The next poll cycle will retry.
      }
    }
    fetchOnce();
    const id = window.setInterval(fetchOnce, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  /* ============================================================
     CRASH CHART — full state machine (climb → bust → reset)
     ------------------------------------------------------------
     Port of the design's <script> block. We pin the SVG path
     attributes via refs so requestAnimationFrame can update them
     at 60fps without re-rendering the component tree on every
     tick.
     ============================================================ */
  const crashLineRef = useRef<SVGPathElement | null>(null);
  const crashFillRef = useRef<SVGPathElement | null>(null);
  const crashDotRef = useRef<SVGCircleElement | null>(null);
  const [crashMult, setCrashMult] = useState(1.0);
  const [crashBusted, setCrashBusted] = useState(false);
  const [crashDelta, setCrashDelta] = useState("▲ +0.00x");
  const [playersIn, setPlayersIn] = useState(412);
  const [roundId, setRoundId] = useState(8421092);
  const fillId = useId();
  const fillRedId = useId();
  const glowId = useId();

  useEffect(() => {
    let raf = 0;
    let mult = 1.0;
    let busted = false;
    let crashAt = 0;
    let startedAt = 0;
    let history: { t: number; m: number }[] = [];

    function startRound() {
      mult = 1.0;
      busted = false;
      crashAt = Math.max(1.2, Math.pow(rand(0, 1), 1.7) * 30 + 1.2);
      startedAt = performance.now();
      history = [{ t: 0, m: 1.0 }];
      setCrashBusted(false);
      setCrashDelta("▲ +0.00x");
      // Reset visuals to the neon-cyan colourway. The bust path
      // mutates these attributes directly; we restore them here.
      if (crashLineRef.current) {
        crashLineRef.current.setAttribute("stroke", "#22D3EE");
      }
      if (crashFillRef.current) {
        crashFillRef.current.setAttribute("fill", `url(#${fillId})`);
      }
      if (crashDotRef.current) {
        crashDotRef.current.setAttribute("fill", "#22D3EE");
      }
      setRoundId((r) => r + 1);
      setPlayersIn(Math.floor(rand(280, 620)));
    }

    function bust() {
      busted = true;
      setCrashBusted(true);
      // NOTE: `lastCrash` (the stat tile in the hero stat row) is NOT
      // updated here anymore — it now reflects REAL aviator data from
      // the backend (see the polling effect below). The hero crash
      // chart's local simulation is purely a visual animation; using
      // its busts to pretend "this was the last real crash" would
      // contradict the actual data on the same page.
      setCrashDelta(`✕ ${mult.toFixed(2)}x`);
      if (crashLineRef.current) {
        crashLineRef.current.setAttribute("stroke", "#FF4D6D");
      }
      if (crashFillRef.current) {
        crashFillRef.current.setAttribute("fill", `url(#${fillRedId})`);
      }
      if (crashDotRef.current) {
        crashDotRef.current.setAttribute("fill", "#FF4D6D");
      }
      window.setTimeout(() => {
        startRound();
      }, 1600);
    }

    function drawChart() {
      if (!history.length) return;
      const W = 800;
      const H = 200;
      const tMax = Math.max(8, history[history.length - 1].t);
      const mMax = Math.max(2.5, history[history.length - 1].m * 1.1);
      let d = "";
      for (let i = 0; i < history.length; i++) {
        const p = history[i];
        const x = (p.t / tMax) * W;
        const y = H - ((p.m - 1) / (mMax - 1)) * (H - 8) - 4;
        d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
      }
      const last = history[history.length - 1];
      const lx = (last.t / tMax) * W;
      const ly = H - ((last.m - 1) / (mMax - 1)) * (H - 8) - 4;
      crashLineRef.current?.setAttribute("d", d);
      crashDotRef.current?.setAttribute("cx", String(lx));
      crashDotRef.current?.setAttribute("cy", String(ly));
      crashFillRef.current?.setAttribute(
        "d",
        d + " L " + lx.toFixed(1) + " " + H + " L 0 " + H + " Z",
      );
    }

    function tick() {
      if (busted) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = (performance.now() - startedAt) / 1000;
      mult = Math.pow(1.07, t * 4);
      if (mult >= crashAt) {
        mult = crashAt;
        setCrashMult(mult);
        history.push({ t, m: mult });
        drawChart();
        bust();
        raf = requestAnimationFrame(tick);
        return;
      }
      setCrashMult(mult);
      history.push({ t, m: mult });
      if (history.length > 400) history.shift();
      drawChart();
      raf = requestAnimationFrame(tick);
    }

    startRound();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fillId, fillRedId]);

  /* ============================================================
     BID GRID — random taken cells that flip every 700ms
     ============================================================ */
  const [bidCells, setBidCells] = useState<("empty" | "taken" | "mine")[]>(
    () => {
      const arr: ("empty" | "taken" | "mine")[] = new Array(64).fill("empty");
      for (let i = 0; i < 64; i++) {
        if (Math.random() < 0.55) arr[i] = "taken";
      }
      arr[11] = "mine";
      return arr;
    },
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      setBidCells((prev) => {
        const next = prev.slice();
        // Pick a random non-mine cell and toggle.
        let attempts = 8;
        while (attempts-- > 0) {
          const i = Math.floor(Math.random() * next.length);
          if (next[i] !== "mine") {
            next[i] = next[i] === "taken" ? "empty" : "taken";
            break;
          }
        }
        return next;
      });
    }, 700);
    return () => window.clearInterval(id);
  }, []);

  /* ============================================================
     TOASTS — "someone just won" every ~8s
     ============================================================ */
  interface ToastEntry {
    id: number;
    flag: string;
    name: string;
    game: string;
    amt: string;
    ago: number;
    exiting?: boolean;
  }
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastIdxRef = useRef(0);
  const toastCounterRef = useRef(0);

  useEffect(() => {
    let alive = true;
    function showOne() {
      if (!alive) return;
      const i = toastIdxRef.current++;
      const who = winnersPool[i % winnersPool.length] ?? "🌐 player";
      const flag = who.match(/\p{Emoji}+/u)?.[0] ?? "🌐";
      const name = who.replace(/^\p{Emoji}+\s*/u, "").trim();
      const game = [
        "Aviator @ 8.2x",
        "Predict — BTC YES",
        "Unique bid · iPhone",
        "Aviator @ 4.8x",
        "Predict — IPL Final",
      ][i % 5];
      const amt =
        locale.currency +
        (i % 2 === 0 ? "" : " ") +
        (i % 3 === 0 ? locale.samples.liquidity : locale.samples.retailValue);
      const id = ++toastCounterRef.current;
      setToasts((prev) => {
        // Keep at most 2 at a time — mirrors the design's behaviour.
        const trimmed = prev.length >= 2 ? prev.slice(-1) : prev;
        return [...trimmed, { id, flag, name, game, amt, ago: Math.floor(rand(3, 42)) }];
      });
      // Schedule the slide-out, then the unmount.
      window.setTimeout(() => {
        setToasts((prev) =>
          prev.map((tt) => (tt.id === id ? { ...tt, exiting: true } : tt)),
        );
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((tt) => tt.id !== id));
        }, 400);
      }, 5200);
    }
    const first = window.setTimeout(showOne, 2500);
    const tick = window.setInterval(showOne, 7800);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(tick);
    };
  }, [winnersPool, locale.currency, locale.samples.liquidity, locale.samples.retailValue]);

  /* ============================================================
     TICKER — recompute when locale / winners pool changes
     ------------------------------------------------------------
     Amounts are random integers in [500, 96_000] formatted via
     Intl in the active locale's numbering convention, then
     prefixed with the locale's currency symbol.

     Why we no longer pull from `locale.samples.{liquidity, …}`:
     those were sized for "headline" amounts (single-bid retail
     value, market liquidity) and skewed toward 10⁵–10⁷ magnitudes.
     For per-winner ticker rows we want believable individual-
     winning numbers — most users winning ₹500-₹95k feels real;
     half the ticker showing ₹1.69 lakh wins reads like marketing
     theatre.

     The cap is a hardcoded 96_000 (raw integer) — the user's
     spec said "<97,000 INR". For non-INR locales we let the
     same integer ride through their `numberFmt`, which is
     slightly inconsistent in purchasing-power terms (₹96k ≠
     R$96k ≠ €96k) but consistent with everything else on the
     page: the locale system here is a presentation skin, not a
     real FX layer. When the backend feeds actual wins, those
     will already be currency-correct.

     The seeded `rand()` (mulberry32 keyed on the locale code +
     pool index) keeps the same row showing the same amount
     across re-renders within a locale; switching countries
     reshuffles. Without the seed, every component re-render
     would lottery a fresh set of numbers.
     ============================================================ */
  const tickerItems = useMemo(() => {
    const games = ["AVIATOR", "PREDICT", "UNIQUE BID"];
    // Seed off the locale code so the same locale always shows the
    // same row → amount mapping (stable on re-renders), but the
    // numbers shift when the user switches countries.
    const seedSource = `${country}::${winnersPool.length}`;
    let seed = 0;
    for (let i = 0; i < seedSource.length; i++) {
      seed = (seed * 31 + seedSource.charCodeAt(i)) >>> 0;
    }
    function nextRand(): number {
      // mulberry32 — small, fast, decent distribution.
      seed = (seed + 0x6D2B79F5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    }

    return winnersPool.map((who, i) => {
      // [500, 96_000] inclusive on the lower bound, exclusive on the
      // upper. floor() because partial currency units look fake here.
      const amount = Math.floor(nextRand() * (96_000 - 500) + 500);
      const formatted = formatNumber(amount, locale.numberFmt);
      // Match the original spacing pattern (no space for the first
      // currency, space otherwise) so symbols like "R$" / "MX$" /
      // "AED " sit naturally next to the digits.
      const amt =
        locale.currency + (i % 6 === 0 ? "" : " ") + formatted;
      const game = games[i % games.length];
      const ago = (((i * 7) % 9) + 1) + "m";
      return { who, amt, game, ago };
    });
  }, [winnersPool, locale.currency, locale.numberFmt, country]);

  /* ============================================================
     LOGIN FORM
     ============================================================ */
  const [mode, setMode] = useState<AuthMode>("login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2FA state — only reachable after step 1 returns needs2FA.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code2fa, setCode2fa] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // For signup vs. login we call the same endpoint — the backend
      // figures out whether to create or authenticate based on the
      // request shape. The form UX differentiates only in copy.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginId,
          password,
          // signup hint — backend may use this to choose between
          // create-or-auth semantics. Same shape as the legacy form.
          intent: mode === "signup" ? "signup" : "login",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        needs2FA?: boolean;
        challengeToken?: string;
      };
      if (!res.ok) {
        setError(body.message ?? "Sign-in failed.");
        return;
      }
      if (body.needs2FA && body.challengeToken) {
        setChallengeToken(body.challengeToken);
        setMode("2fa");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function on2FASubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          code: code2fa.trim(),
          trustDevice,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(body.message ?? "Invalid code.");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function back1Step() {
    setMode("login");
    setChallengeToken(null);
    setCode2fa("");
    setError(null);
  }

  /* ============================================================
     Telegram start — hands off to /api/auth/telegram/start which
     redirects the browser to the Telegram Login Widget bot flow
     (oauth.telegram.org). The callback comes back to
     /api/auth/telegram/callback, which verifies the HMAC and sets
     the session cookie. See lib/telegram.ts + the API route.
     ============================================================ */
  function startTelegram() {
    window.location.href =
      "/api/auth/telegram/start?next=" + encodeURIComponent(next);
  }

  /* ============================================================
     SCROLL BACK + HIGHLIGHT — wires the three market-card CTAs
     ------------------------------------------------------------
     The market cards at the bottom of the page are conversion
     nudges, not real entries. Clicking any of them smooth-scrolls
     the viewport back up to the login card and flashes the card
     for ~2.4s so the user's attention re-anchors there.
     Also flips the auth mode to "signup" because anyone tapping
     a market CTA from an unauthenticated state is, by definition,
     a new-user funnel.
     ============================================================ */
  const loginCardRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const scrollBackAndHighlight = useCallback(() => {
    const el = loginCardRef.current;
    if (!el) return;
    // `block: "center"` keeps the card visible regardless of the
    // user's current scroll position — works on both desktop
    // (login is top-right) and mobile (login is above the hero).
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("highlight-pulse");
    // Force reflow so re-adding the class restarts the animation
    // even if the user mashes the same CTA repeatedly.
    void el.offsetWidth;
    el.classList.add("highlight-pulse");
    setMode("signup");
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      el.classList.remove("highlight-pulse");
      highlightTimerRef.current = null;
    }, 2400);
  }, []);

  // Clean up the highlight timer on unmount — prevents the timer
  // firing on a stale DOM node after a route change.
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  /* ============================================================
     DEMO USER CHIP — fills the form with a seeded account
     ============================================================ */
  function fillDemoUser(email: string) {
    setLoginId(email);
    setPassword(SHARED_PASSWORD);
    setError(null);
  }

  /* ============================================================
     RENDER
     ============================================================ */

  // Pre-format the live counters in the current locale.
  const paidOutLabel = formatNumber(paidOut, locale.numberFmt);
  const playersOnlineLabel = formatNumber(playersOnline, locale.numberFmt);
  const activePredLabel = formatNumber(Math.max(3200, activePred), locale.numberFmt);
  const liveMarketsLabel = activePredLabel;
  const loginOnlineLabel = formatNumber(loginOnline, locale.numberFmt);
  const roundLabel = roundId.toLocaleString("en-IN").replace(/,/g, " ");

  return (
    <main className="kalki-login-page" data-lang={lang}>
      <div className="bg-stack" aria-hidden="true">
        <div className="bg-mesh" />
        <div className="orb a" />
        <div className="orb b" />
        <div className="bg-grid" />
        <div className="bg-grain" />
      </div>

      <div className="page">
        {/* ─────────── NAV ─────────── */}
        <nav className="nav" aria-label="Site">
          <a className="brand" href="/">
            {/* ============ LOGO SLOT — START ============
                Drop-in placeholder. Devs swap the inner <svg> with
                the final mark or `<img src="/logo.svg">`. The 28×28
                container + cyan→indigo gradient bg + glow live in
                CSS. */}
            <span className="brand-mark" aria-label="kalki.bet logo">
              <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <text
                  x="16"
                  y="22"
                  textAnchor="middle"
                  fontFamily="Space Grotesk, sans-serif"
                  fontWeight="700"
                  fontSize="20"
                  fill="#020617"
                >
                  K
                </text>
              </svg>
            </span>
            {/* ============ /LOGO SLOT ============ */}
            <span className="brand-word">
              kalki<span className="brand-dot">.</span>bet
            </span>
          </a>

          <div className="nav-right">
            <span className="nav-pill">
              <span className="live-dot" />
              <span>{playersOnlineLabel}</span>&nbsp;
              <span>{t("nav_online_now")}</span>
            </span>

            {/* Locale switcher */}
            <div className="loc">
              <button
                ref={locBtnRef}
                className="loc-btn"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={locMenuOpen}
                onClick={() => setLocMenuOpen((v) => !v)}
              >
                <span className="loc-flag">{locale.flag}</span>
                <span className="loc-code">
                  {country} · {locale.currency.trim()}
                </span>
                <span className="loc-caret">▾</span>
              </button>
              {locMenuOpen && (
                <div
                  ref={locMenuRef}
                  className="loc-menu"
                  role="listbox"
                  aria-label="Choose your country"
                >
                  {(Object.entries(LOCALES) as Array<[CountryCode, typeof locale]>).map(
                    ([code, L]) => (
                      <button
                        key={code}
                        className={`loc-item ${code === country ? "active" : ""}`}
                        role="option"
                        aria-selected={code === country}
                        type="button"
                        onClick={() => selectCountry(code)}
                      >
                        <span className="flag">{L.flag}</span>
                        <span className="name">{L.name}</span>
                        <span className="meta">
                          {code} · {L.currency.trim()}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        </nav>

        {/* ─────────── HERO ─────────── */}
        <section className="hero">
          {/* LEFT */}
          <div className="hero-left">
            <span className="eyebrow">
              <svg
                className="ic-sm"
                viewBox="0 0 24 24"
                fill="currentColor"
                style={{ color: "var(--neon)" }}
              >
                <circle cx="12" cy="12" r="5" />
              </svg>
              <span>{t("hero_eyebrow")}</span>
            </span>

            <h1 className="headline">
              <span>{t("headline_lead")}</span>{" "}
              <span className="accent">{t("headline_accent")}</span>
              <br />
              <span>{t("headline_into")}</span>
              <br />
              <span className="strike">{t("headline_strike")}</span>
            </h1>

            <p className="subcopy">{t("hero_subcopy")}</p>

            {/* Live stats */}
            <div className="stat-row">
              <div className="stat">
                <div className="stat-label">
                  <span className="live-dot" />
                  <span>{t("stat_paid_today")}</span>
                </div>
                <div className="stat-value neon">
                  <span>{locale.currency}</span>
                  <span>{paidOutLabel}</span>
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">{t("stat_players_online")}</div>
                <div className="stat-value">{playersOnlineLabel}</div>
              </div>
              <div className="stat">
                <div className="stat-label">{t("stat_last_crash")}</div>
                <div className="stat-value gold">
                  {/* Real value from /api/aviator/last-crash. While the
                      first poll is in flight (or backend is empty /
                      down) we render an em-dash rather than a fake
                      static "18.24" — accurate placeholder beats
                      believable-looking lies. */}
                  {lastCrashBackend === null ? (
                    "—"
                  ) : (
                    <>
                      {lastCrashBackend.toFixed(2)}
                      <span style={{ fontSize: 14, opacity: 0.7 }}>x</span>
                    </>
                  )}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">{t("stat_active_predictions")}</div>
                <div className="stat-value">{activePredLabel}</div>
              </div>
            </div>

            {/* Crash chart */}
            <div className="crash">
              <div className="crash-head">
                <div className="crash-title">
                  <span className="tag">AVIATOR</span>
                  <span>
                    {t("crash_round")}
                    {roundLabel}
                  </span>
                </div>
                <div className="crash-meta">
                  <span>
                    <b>{playersIn}</b>&nbsp;{t("crash_in")}
                  </span>
                  <span>
                    {t("crash_pot")}&nbsp;
                    <b>
                      <span>{locale.currency}</span>
                      <span>{locale.samples.pot}</span>
                    </b>
                  </span>
                  <span>
                    {t("crash_cashout_window")}&nbsp;<b>3.2s</b>
                  </span>
                </div>
              </div>

              <div className={`crash-mult ${crashBusted ? "busted" : ""}`}>
                <span>{crashMult.toFixed(2)}</span>
                <span className="x">x</span>
              </div>
              <div className="crash-sub">
                <span dangerouslySetInnerHTML={htmlString("crash_will_10x", lang)} />
                <span className={`delta ${crashBusted ? "busted" : ""}`}>
                  {crashDelta}
                </span>
              </div>

              <div className="chart-wrap">
                <div className="chart-grid" />
                <svg viewBox="0 0 800 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id={fillRedId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF4D6D" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#FF4D6D" stopOpacity="0" />
                    </linearGradient>
                    <filter id={glowId}>
                      <feGaussianBlur stdDeviation="3" result="b" />
                      <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <path
                    ref={crashFillRef}
                    d="M0 200 L0 200 Z"
                    fill={`url(#${fillId})`}
                  />
                  <path
                    ref={crashLineRef}
                    d="M0 200"
                    stroke="#22D3EE"
                    strokeWidth="2.5"
                    fill="none"
                    filter={`url(#${glowId})`}
                  />
                  <circle
                    ref={crashDotRef}
                    cx="0"
                    cy="200"
                    r="5"
                    fill="#22D3EE"
                    filter={`url(#${glowId})`}
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* RIGHT — LOGIN CARD */}
          <aside className="login-wrap" aria-label="Sign in">
            <div className="login-glow" />
            <div className="login" ref={loginCardRef}>
              <span className="live-tag">
                <span className="live-dot" />
                <span>{loginOnlineLabel}</span>&nbsp;
                <span>{t("login_joining_now")}</span>
              </span>

              {mode !== "2fa" && (
                <>
                  <div className="login-head">
                    <div className="login-tabs" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "login"}
                        className={mode === "login" ? "active" : ""}
                        onClick={() => setMode("login")}
                      >
                        {t("login_tab_login")}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "signup"}
                        className={mode === "signup" ? "active" : ""}
                        onClick={() => setMode("signup")}
                      >
                        {t("login_tab_signup")}
                      </button>
                    </div>
                  </div>

                  <h2 className="login-title">
                    {mode === "signup"
                      ? t("login_title_signup")
                      : t("login_title_login")}
                  </h2>
                  <p className="login-sub">
                    {mode === "signup"
                      ? t("login_sub_signup")
                      : t("login_sub_login")}
                  </p>

                  {/* Telegram OAuth — always rendered. The design treats
                      this as the canonical sign-in path (it's the only
                      social-auth option after PR-AUTH-CLEANUP dropped
                      Google + Apple). If the Telegram env (bot token /
                      public username) isn't configured server-side,
                      clicking the button hits /api/auth/telegram/start
                      which surfaces an explicit 503 — strictly better
                      UX than silently hiding the only OAuth entry. */}
                  <div className="oauth">
                    <button
                      type="button"
                      className="oauth-btn"
                      aria-label="Continue with Telegram"
                      onClick={startTelegram}
                    >
                      <svg
                        className="ic"
                        viewBox="0 0 24 24"
                        fill="#5BB2FF"
                        aria-hidden
                      >
                        <path d="M9.8 15.6L9.6 18.7c.4 0 .6-.2.8-.4l1.9-1.8 4 2.9c.7.4 1.2.2 1.4-.7l2.6-12c.2-1.1-.4-1.5-1.1-1.3L4.6 11.3c-1.1.4-1 1-.2 1.3l3.8 1.2 8.9-5.6c.4-.3.8-.1.5.2" />
                      </svg>
                      <span>{t("login_continue_telegram")}</span>
                    </button>
                  </div>

                  <div className="divider">{t("login_or")}</div>

                  <form onSubmit={onPasswordSubmit} autoComplete="on">
                    <div className="field">
                      <label className="field-label" htmlFor="loginId">
                        {t("login_email_phone")}
                      </label>
                      <input
                        id="loginId"
                        name="loginId"
                        type="text"
                        inputMode="email"
                        autoComplete="username"
                        value={loginId}
                        onChange={(e) => setLoginId(e.target.value)}
                        required
                      />
                    </div>
                    <div className="field">
                      <div className="field-row">
                        <label className="field-label" htmlFor="pass">
                          {t("login_password")}
                        </label>
                        <button
                          className="toggle-pass"
                          type="button"
                          onClick={() => setShowPass((v) => !v)}
                          aria-pressed={showPass}
                        >
                          {showPass ? t("login_hide") : t("login_show")}
                        </button>
                      </div>
                      <input
                        id="pass"
                        name="pass"
                        type={showPass ? "text" : "password"}
                        placeholder="••••••••••"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                      />
                    </div>

                    {error && <div className="login-error">{error}</div>}

                    <button
                      type="submit"
                      className="submit shimmer"
                      disabled={busy || !loginId || !password}
                    >
                      <span>
                        {busy
                          ? t("login_securing")
                          : mode === "signup"
                            ? t("login_claim")
                            : t("login_play_now")}
                      </span>
                      <span className="arrow">→</span>
                    </button>

                    <div className="login-foot">
                      {mode === "signup" ? (
                        // Signup mode: toggle back to login.
                        <button
                          type="button"
                          onClick={() => setMode("login")}
                        >
                          {t("login_have_account")}
                        </button>
                      ) : (
                        // Login mode: navigate to the dedicated forgot-
                        // password page (a separate route — has its own
                        // email/token state machine, not just a mode flip).
                        <a href="/auth/forgot">{t("login_forgot")}</a>
                      )}
                      <span>
                        {mode === "signup"
                          ? t("login_takes")
                          : t("login_trusted_by")}
                      </span>
                    </div>

                    {demoVisible && (
                      <div className="demo-users">
                        <div className="demo-users-label">
                          Demo users · password <code>{SHARED_PASSWORD}</code>
                        </div>
                        <div className="demo-users-row">
                          {DEMO_USERS.map((u) => (
                            <button
                              key={u.email}
                              type="button"
                              className={`demo-user-chip ${u.kind === "admin" ? "admin" : ""}`}
                              onClick={() => fillDemoUser(u.email)}
                            >
                              {u.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </form>
                </>
              )}

              {mode === "2fa" && (
                <>
                  <h2 className="login-title">{t("login_2fa_title")}</h2>
                  <p className="login-sub">{t("login_2fa_sub")}</p>

                  <form onSubmit={on2FASubmit}>
                    <div className="field" style={{ marginTop: 14 }}>
                      <label className="field-label" htmlFor="code2fa">
                        {t("login_2fa_code")}
                      </label>
                      <input
                        id="code2fa"
                        name="code2fa"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={32}
                        autoFocus
                        value={code2fa}
                        onChange={(e) => setCode2fa(e.target.value)}
                        className="twofa-code-input"
                      />
                    </div>

                    <label className="twofa-trust">
                      <input
                        type="checkbox"
                        checked={trustDevice}
                        onChange={(e) => setTrustDevice(e.target.checked)}
                      />
                      <span>{t("login_2fa_trust")}</span>
                    </label>

                    {error && <div className="login-error">{error}</div>}

                    <button
                      type="submit"
                      className="submit shimmer"
                      disabled={busy || !code2fa}
                    >
                      <span>
                        {busy ? t("login_securing") : t("login_2fa_submit")}
                      </span>
                      <span className="arrow">→</span>
                    </button>

                    <div className="login-foot">
                      <button type="button" onClick={back1Step}>
                        {t("login_2fa_back")}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </aside>
        </section>

        {/* ─────────── BELOW HERO ─────────── */}
        <section className="below">
          {/* WINNER TICKER */}
          <div className="ticker" aria-label="Recent winners">
            <div className="ticker-track">
              {[...tickerItems, ...tickerItems].map((it, i) => (
                <div className="ticker-item" key={`tk-${i}`}>
                  <span className="game">{it.game}</span>
                  <span className="who">{it.who}</span>
                  <span>{t("ticker_just_won")}</span>
                  <span className="amt">{it.amt}</span>
                  <span className="time">
                    · {it.ago} {t("ticker_ago")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* MARKETS HEAD */}
          <div className="markets-head">
            <h2 className="markets-title">
              <span>{t("markets_title_a")}</span>{" "}
              <em>{t("markets_title_em")}</em>.<br />
              <span>{t("markets_title_b")}</span>
            </h2>
            <div className="markets-meta">
              <span>
                <span
                  className="live-dot"
                  style={{ display: "inline-block", verticalAlign: "middle" }}
                />
                &nbsp;<span>{liveMarketsLabel}</span>&nbsp;
                <span>{t("markets_live")}</span>
              </span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{t("markets_settled")}</span>
            </div>
          </div>

          {/*
            MARKET CARDS — each entire card is a <button> that calls
            scrollBackAndHighlight(). The .market-cta pill inside is
            decorative (pointer-events: none in CSS) so the click
            target is consistent regardless of where the user taps.
          */}
          <div className="markets">
            {/* 1. Prediction */}
            <button
              type="button"
              className="market"
              onClick={scrollBackAndHighlight}
              aria-label={t("m1_cta")}
            >
              <div className="market-head">
                <span className="market-kind">{t("m1_kind")}</span>
                <span className="market-status blue">
                  <span>{t("m1_status")}</span>&nbsp;04:18
                </span>
              </div>
              <div
                className="market-q"
                dangerouslySetInnerHTML={htmlString("m1_q", lang)}
              />
              <div className="market-viz">
                <div className="yesno">
                  <div className="yesno-bar yes">
                    <span>{t("m1_yes")}</span>
                    <span>68¢</span>
                  </div>
                  <div className="yesno-bar no">
                    <span>{t("m1_no")}</span>
                    <span>32¢</span>
                  </div>
                </div>
              </div>
              <div className="market-foot">
                <div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "var(--text-3)",
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("m1_liquidity")}
                  </div>
                  <div className="market-pot neon">
                    <span>{locale.currency}</span>
                    <span>{locale.samples.liquidity}</span>
                  </div>
                </div>
                <span className="market-cta">
                  <span>{t("m1_cta")}</span>{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>→</span>
                </span>
              </div>
            </button>

            {/* 2. Aviator */}
            <button
              type="button"
              className="market"
              onClick={scrollBackAndHighlight}
              aria-label={t("m2_cta")}
            >
              <div className="market-head">
                <span className="market-kind">{t("m2_kind")}</span>
                <span className="market-status live">
                  <span
                    className="live-dot"
                    style={{ display: "inline-block", verticalAlign: "middle" }}
                  />
                  &nbsp;<span>{t("m2_live")}</span>
                </span>
              </div>
              <div className="market-q">
                <span>{t("m2_q1")}</span>
                <br />
                <span>{t("m2_q2")}</span>
              </div>
              <div className="market-viz">
                <svg
                  className="aviator-mini"
                  viewBox="0 0 220 80"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M0 78 Q60 75 90 60 T180 14"
                    stroke="#22D3EE"
                    strokeWidth="2"
                    fill="none"
                    filter={`url(#${glowId})`}
                  />
                  <path
                    d="M0 78 Q60 75 90 60 T180 14 L180 80 L0 80 Z"
                    fill={`url(#${fillId})`}
                    opacity="0.6"
                  />
                  <circle cx="180" cy="14" r="3" fill="#22D3EE" />
                </svg>
                <span className="aviator-mult">7.42x</span>
              </div>
              <div className="market-foot">
                <div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "var(--text-3)",
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("m2_in_flight")}
                  </div>
                  <div className="market-pot">
                    412{" "}
                    <span style={{ color: "var(--text-3)", fontSize: 13 }}>
                      {t("m2_players")}
                    </span>
                  </div>
                </div>
                <span className="market-cta">
                  <span>{t("m2_cta")}</span>{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>↗</span>
                </span>
              </div>
            </button>

            {/* 3. Lowest unique bid */}
            <button
              type="button"
              className="market"
              onClick={scrollBackAndHighlight}
              aria-label={t("m3_cta")}
            >
              <div className="market-head">
                <span className="market-kind">{t("m3_kind")}</span>
                <span className="market-status gold">{t("m3_jackpot")}</span>
              </div>
              <div className="market-q">
                <span>{t("m3_q_a")}</span>
                <span style={{ color: "var(--gold)" }}>
                  <span>{t("m3_q_won")}</span>&nbsp;
                  <span>{locale.currency}</span>1
                </span>
                &nbsp;<span>{t("m3_q_b")}</span>
              </div>
              <div className="market-viz">
                <div className="bid-grid">
                  {bidCells.map((state, i) => (
                    <div
                      key={i}
                      className={`bid-cell ${state === "taken" ? "taken" : ""} ${
                        state === "mine" ? "mine" : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="market-foot">
                <div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "var(--text-3)",
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("m3_retail")}
                  </div>
                  <div className="market-pot gold">
                    <span>{locale.currency}</span>
                    <span>{locale.samples.retailValue}</span>
                  </div>
                </div>
                <span className="market-cta">
                  <span>{t("m3_cta")}</span>{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>→</span>
                </span>
              </div>
            </button>
          </div>

          {/* TRUST BAR */}
          <div className="trust">
            <div className="trust-cell">
              <div className="trust-num">
                10<span className="unit">{t("trust_countries")}</span>
              </div>
              <div className="trust-label">{t("trust_countries_label")}</div>
            </div>
            <div className="trust-cell">
              <div className="trust-num">
                &lt;4<span className="unit">{t("trust_payouts")}</span>
              </div>
              <div className="trust-label">{t("trust_payouts_label")}</div>
            </div>
            <div className="trust-cell">
              <div className="trust-num">
                24<span className="unit">{t("trust_action")}</span>
              </div>
              <div className="trust-label">{t("trust_action_label")}</div>
            </div>
            <div className="trust-cell">
              <div className="trust-num">
                1.2<span className="unit">{t("trust_players")}</span>
              </div>
              <div className="trust-label">{t("trust_players_label")}</div>
            </div>
          </div>

          <p
            style={{
              textAlign: "center",
              fontSize: "11.5px",
              color: "var(--text-3)",
              letterSpacing: ".08em",
              marginTop: 24,
            }}
          >
            {t("legal_responsible")}
          </p>
        </section>
      </div>

      {/* ─────────── TOASTS ─────────── */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((tt) => (
          <div key={tt.id} className={`toast ${tt.exiting ? "out" : ""}`}>
            <div className="toast-avatar">{tt.flag}</div>
            <div className="toast-body">
              <div className="toast-name">
                <b>{tt.name}</b> {t("toast_cashed_out")}{" "}
                <span className="toast-amt">{tt.amt}</span>
              </div>
              <div className="toast-meta">
                {tt.game} · {tt.ago}s {t("ticker_ago")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

// Make `STRINGS` reachable from devtools for QA. Read-only.
if (typeof window !== "undefined") {
  (window as unknown as { __KALKI_STRINGS?: typeof STRINGS }).__KALKI_STRINGS =
    STRINGS;
}

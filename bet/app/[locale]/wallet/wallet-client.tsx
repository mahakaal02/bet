"use client";

import { useEffect, useState } from "react";
import { fmtCoins } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/client";

/* ─────────────────────────────────────────────────────────────
   Secure Kalki Chat — single Telegram-login-style button.

   One full-width button: clicking it sends the user to the admin-
   configured Secure Chat app link (starts the APK download / opens
   the app's store page). The URL is set by a super-admin at
   /admin/settings → secure chat app url.
   ───────────────────────────────────────────────────────────── */
export function SecureChatActions({ downloadUrl }: { downloadUrl: string }) {
  const { t } = useTranslation();
  function go() {
    if (downloadUrl) {
      window.location.href = downloadUrl;
    } else {
      alert(t("wallet.chatNotConfigured"));
    }
  }
  return (
    <button type="button" className="chat-btn" onClick={go}>
      <svg className="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9.8 15.6L9.6 18.7c.4 0 .6-.2.8-.4l1.9-1.8 4 2.9c.7.4 1.2.2 1.4-.7l2.6-12c.2-1.1-.4-1.5-1.1-1.3L4.6 11.3c-1.1.4-1 1-.2 1.3l3.8 1.2 8.9-5.6c.4-.3.8-.1.5.2" />
      </svg>
      <span>{t("wallet.chatButton")}</span>
    </button>
  );
}

/* Theme switch — classic / neon. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<"classic" | "neon">("classic");
  useEffect(() => {
    const saved =
      (localStorage.getItem("kalki-theme") as "classic" | "neon" | null) ?? "classic";
    document.documentElement.setAttribute("data-theme", saved);
    setTheme(saved);
  }, []);
  function pick(t: "classic" | "neon") {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("kalki-theme", t);
    setTheme(t);
  }
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      <button className={theme === "classic" ? "on" : ""} onClick={() => pick("classic")} title="Classic" aria-label="Classic theme">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
      <button className={theme === "neon" ? "on" : ""} onClick={() => pick("neon")} title="Neon" aria-label="Neon theme">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </button>
    </div>
  );
}

/* Balance hero — big number + Coins/Value/Hidden toggle + actions. */
export function BalanceHero({
  balanceCoins,
  valueLabel,
  currencyCode,
  last24h,
  syncedLabel,
}: {
  balanceCoins: number;
  valueLabel: string | null;
  currencyCode: string | null;
  last24h: number;
  syncedLabel: string;
}) {
  const { t, locale } = useTranslation();
  const [mode, setMode] = useState<"coins" | "value" | "hidden">("coins");

  const display =
    mode === "hidden"
      ? "••••••"
      : mode === "value" && valueLabel
        ? valueLabel
        : fmtCoins(balanceCoins, locale);
  const showUnit = mode === "coins";

  return (
    <section className="card balance-card" data-screen-label="Balance">
      <div className="balance-top">
        <span className="balance-lbl">
          {t("wallet.currentBalance")} · {t("wallet.unified")}
        </span>
        <div className="balance-toggle" role="tablist">
          <button className={mode === "coins" ? "on" : ""} onClick={() => setMode("coins")}>
            {t("wallet.toggleCoins")}
          </button>
          {valueLabel && (
            <button className={mode === "value" ? "on" : ""} onClick={() => setMode("value")}>
              {currencyCode ?? "Value"}
            </button>
          )}
          <button className={mode === "hidden" ? "on" : ""} onClick={() => setMode("hidden")}>
            {t("wallet.toggleHidden")}
          </button>
        </div>
      </div>

      <div className="balance-num">
        <span className="v">{display}</span>
        {showUnit && <span className="unit">{t("wallet.coins")}</span>}
      </div>

      <div className="balance-sub">
        {mode !== "hidden" && valueLabel && (
          <span>
            ≈ <strong>{valueLabel}</strong>
          </span>
        )}
        <span className="chip cyan">{t("wallet.unifiedNote")}</span>
        {mode !== "hidden" && last24h !== 0 && (
          <span className="chip">
            {last24h > 0 ? "+" : "−"}
            <strong style={{ color: "var(--emerald-300)" }}>
              {fmtCoins(Math.abs(last24h), locale)}
            </strong>{" "}
            {t("wallet.last24h")}
          </span>
        )}
      </div>

      <div className="balance-actions">
        <a className="btn primary" href="#buy">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("wallet.buyCoins")}
        </a>
        <button className="btn ghost" onClick={() => setMode(mode === "hidden" ? "coins" : "hidden")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12c-2.5 5-7 7-9 7s-6.5-2-9-7c2.5-5 7-7 9-7s6.5 2 9 7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {mode === "hidden" ? t("wallet.show") : t("wallet.hide")}
        </button>
        <span className="spacer" />
        <span className="balance-meta">
          <span className="ok">●</span> {syncedLabel}
        </span>
      </div>
    </section>
  );
}

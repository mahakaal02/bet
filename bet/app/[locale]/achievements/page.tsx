import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../markets/markets-v2.css";
import {
  ExchangeTopbar,
  ExchangeFooter,
  ExchangeBackdrop,
} from "@/components/ExchangeChrome";
import { db } from "@/lib/db";
import { getAuthedUser } from "@/lib/auth";
import { fmtCoins, timeAgo } from "@/lib/utils";
import {
  DEFAULT_LOCALE,
  buildLocalizedMetadata,
  isLocale,
  t,
  type Locale,
} from "@/lib/i18n";
import { hubLoginUrl } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return buildLocalizedMetadata({
    locale,
    path: "/achievements",
    title: t("meta.achievementsTitle", locale),
    description: t("meta.achievementsDescription", locale),
  });
}

/**
 * Achievements catalog — re-skinned onto the Markets v2 system (shared
 * chrome + panels + tile grid). Anonymous visitors see every tile locked
 * (a "what can I earn?" preview) plus a sign-in prompt.
 */
export default async function AchievementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);

  const u = await getAuthedUser();
  const [catalog, mine, totalUnlocked] = await Promise.all([
    db.achievement.findMany({ orderBy: { sortOrder: "asc" } }),
    u
      ? db.userAchievement.findMany({
          where: { userId: u.id },
          orderBy: { unlockedAt: "desc" },
        })
      : Promise.resolve([]),
    db.userAchievement.count(),
  ]);

  const unlockedAt = new Map(mine.map((m) => [m.achievementId, m.unlockedAt]));
  const grouped = await db.userAchievement.groupBy({
    by: ["achievementId"],
    _count: { achievementId: true },
  });
  const earnsByAch = new Map(
    grouped.map((g) => [g.achievementId, g._count.achievementId]),
  );

  const items = catalog.map((a) => ({
    ...a,
    unlockedAt: unlockedAt.get(a.id) ?? null,
    earnedCount: earnsByAch.get(a.id) ?? 0,
  }));

  const recent = mine
    .map((m) => {
      const a = catalog.find((c) => c.id === m.achievementId);
      if (!a) return null;
      return { ...a, unlockedAt: m.unlockedAt };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 6);

  const myCount = mine.length;

  return (
    <div className="mkt">
      <ExchangeBackdrop />
      <ExchangeTopbar locale={locale} />

      <main className="page content">
        <div className="page-head">
          <div>
            <div className="crumbs">
              <span>{tr("market.crumbTrade")}</span>
              <span className="sep">/</span>
              <span className="here">{tr("achievements.heading")}</span>
            </div>
            <h1 className="page-title">
              <em>{tr("achievements.heading")}</em>
            </h1>
            <p className="page-sub">{tr("achievements.subtext")}</p>
          </div>
          {u && (
            <div className="page-stats">
              <div
                className="counter"
                aria-label={tr("achievements.unlockedCount", {
                  count: myCount,
                  total: catalog.length,
                })}
              >
                <div className="v">
                  {myCount}/{catalog.length}
                </div>
                <div className="l">{tr("achievements.badge")}</div>
              </div>
            </div>
          )}
        </div>

        {u && recent.length > 0 && (
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-head">
              <div className="panel-title">
                {tr("achievements.recentlyUnlocked")}
              </div>
              <span className="panel-meta">{recent.length}</span>
            </div>
            <div className="rail">
              {recent.map((a) => (
                <div key={a.id} className="rail-tile">
                  <div className="ic">{a.icon}</div>
                  <div className="nm">{a.title}</div>
                  <div className="tm">{timeAgo(a.unlockedAt, locale)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel-head">
            <div className="panel-title">
              {tr("achievements.allAchievements")}
            </div>
            <span className="panel-meta">
              {tr("achievements.unlocksAcrossUsers", {
                count: fmtCoins(totalUnlocked, locale),
              })}
            </span>
          </div>
          <div className="ach-grid">
            {items.map((a) => {
              const unlocked = !!a.unlockedAt;
              return (
                <div
                  key={a.id}
                  className={`ach ${unlocked ? "unlocked" : "locked"}`}
                >
                  <div className="ach-icon">{a.icon}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="ach-name">{a.title}</span>
                      <span className={`tag ${unlocked ? "yes" : ""}`}>
                        {unlocked
                          ? tr("achievements.badge")
                          : tr("achievements.locked")}
                      </span>
                    </div>
                    <p className="ach-desc">{a.description}</p>
                    <div className="ach-foot">
                      <span>
                        {tr("achievements.reward", {
                          coins: fmtCoins(a.rewardCoins, locale),
                          xp: a.rewardXp,
                        })}
                      </span>
                      <span>
                        {a.earnedCount > 0
                          ? tr("achievements.earned", {
                              count: fmtCoins(a.earnedCount, locale),
                            })
                          : tr("achievements.beFirst")}
                      </span>
                    </div>
                    {unlocked && a.unlockedAt && (
                      <div
                        className="ach-foot"
                        style={{ color: "var(--cyan-300)" }}
                      >
                        {tr("achievements.unlockedTime", {
                          time: timeAgo(a.unlockedAt, locale),
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {!u && (
          <section
            className="panel"
            style={{ marginTop: 16, textAlign: "center" }}
          >
            <p className="panel-sub">{tr("achievements.signInNote")}</p>
            {/* Single account-creation surface lives on the hub; cross-origin
                so a plain anchor (not next/link). */}
            <a
              className="btn primary"
              href={hubLoginUrl()}
              style={{ marginTop: 12 }}
            >
              {tr("achievements.createAccount")}
            </a>
          </section>
        )}
      </main>

      <ExchangeFooter locale={locale} />
    </div>
  );
}

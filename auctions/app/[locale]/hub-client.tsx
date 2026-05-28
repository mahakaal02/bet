"use client";

import "./hub.css";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Locale dictionaries for the Kalki hub. Mirrors the shape used by
 * `app/login/locale-data.ts` so a future consolidation can union the
 * two — kept separate for now because the hub needs different sample
 * keys (equiv vs paidOut) and different strings (greeting vs login
 * copy).
 *
 * Adding a market: drop a new entry into both LOCALES and STRINGS
 * (and ideally into WINNERS_BY_REGION so the ticker reads locally).
 * STRINGS falls back to `en` for any key missing from a non-en lang.
 */

type LangCode = "en" | "pt" | "es" | "fr" | "ru" | "zh" | "id";
type CountryCode =
  | "IN" | "BR" | "FR" | "RU" | "PH" | "CN" | "MX" | "ID" | "NG" | "AE" | "US";

interface Locale {
  lang: LangCode;
  currency: string;
  flag: string;
  name: string;
  numberFmt: string;
  samples: { liquidity: string; retailValue: string; equiv: string };
  /**
   * ISO 4217 code used to look up the runtime-fetched FX rate (see
   * `auctions/lib/fx.ts`). The backend stores `Auction.retailPrice`
   * in INR, so this code drives the conversion when the user flips
   * the country selector. No conversion *rate* is hardcoded here
   * intentionally — they come from yesterday's ECB closing prices
   * via Frankfurter at request time.
   */
  currencyCode: string;
}

// Static sample numbers used in the featured-product / trending-market
// cards. Originally each locale had its values pre-formatted in NATIVE
// grouping (e.g. BR "9.999", ID "24.999.000") — but that triggers the
// same dot-as-thousands ambiguity the user flagged for dynamic prices.
// All `retailValue` strings now use the universal `,` thousands /
// `.` decimal convention so they read unambiguously regardless of
// the viewer's regional intuition. `liquidity` and `equiv` are
// abbreviated (K / L / M / 万 / млн) — those suffixes already
// disambiguate, so we leave the locale-native decimal mark there for
// the abbreviated forms.
const LOCALES: Record<CountryCode, Locale> = {
  IN: { lang: "en", currency: "₹",    flag: "🇮🇳", name: "India",         numberFmt: "en-IN", currencyCode: "INR",
        samples: { liquidity: "14.2L",   retailValue: "1,69,900",  equiv: "5,259" } },
  BR: { lang: "pt", currency: "R$",   flag: "🇧🇷", name: "Brasil",        numberFmt: "pt-BR", currencyCode: "BRL",
        samples: { liquidity: "38.2K",   retailValue: "9,999",     equiv: "262" } },
  FR: { lang: "fr", currency: "€",    flag: "🇫🇷", name: "France",        numberFmt: "fr-FR", currencyCode: "EUR",
        samples: { liquidity: "142K",    retailValue: "1,749",     equiv: "49" } },
  RU: { lang: "ru", currency: "₽",    flag: "🇷🇺", name: "Россия",        numberFmt: "ru-RU", currencyCode: "RUB",
        samples: { liquidity: "1.4 млн", retailValue: "149,990",   equiv: "5,259" } },
  PH: { lang: "en", currency: "₱",    flag: "🇵🇭", name: "Philippines",   numberFmt: "en-PH", currencyCode: "PHP",
        samples: { liquidity: "142K",    retailValue: "89,990",    equiv: "3,000" } },
  CN: { lang: "zh", currency: "¥",    flag: "🇨🇳", name: "中国",           numberFmt: "zh-CN", currencyCode: "CNY",
        samples: { liquidity: "14.2万",  retailValue: "12,999",    equiv: "380" } },
  MX: { lang: "es", currency: "MX$",  flag: "🇲🇽", name: "México",        numberFmt: "es-MX", currencyCode: "MXN",
        samples: { liquidity: "38K",     retailValue: "28,999",    equiv: "1,049" } },
  ID: { lang: "id", currency: "Rp",   flag: "🇮🇩", name: "Indonesia",     numberFmt: "id-ID", currencyCode: "IDR",
        samples: { liquidity: "1.4M",    retailValue: "24,999,000", equiv: "824,000" } },
  NG: { lang: "en", currency: "₦",    flag: "🇳🇬", name: "Nigeria",       numberFmt: "en-NG", currencyCode: "NGN",
        samples: { liquidity: "380K",    retailValue: "1,49,000",  equiv: "82,500" } },
  AE: { lang: "en", currency: "AED ", flag: "🇦🇪", name: "UAE",           numberFmt: "en-AE", currencyCode: "AED",
        samples: { liquidity: "14.2K",   retailValue: "4,999",     equiv: "189" } },
  US: { lang: "en", currency: "$",    flag: "🇺🇸", name: "United States", numberFmt: "en-US", currencyCode: "USD",
        samples: { liquidity: "142K",    retailValue: "1,199",     equiv: "63" } },
};

/**
 * Convert an INR-denominated amount (string from the backend, or a
 * raw number) to the locale's currency using the runtime-fetched
 * FX rate table. When the rate is missing (FX source temporarily
 * unreachable), falls back to the raw INR figure so the displayed
 * value is still finite — see `auctions/lib/fx.ts::convertFromINR`
 * for the rationale.
 */
function convertFromINR(
  inrAmount: string | number,
  locale: Locale,
  fxRates: Partial<Record<string, number>>,
): number {
  const n = typeof inrAmount === "string" ? Number(inrAmount) : inrAmount;
  if (!Number.isFinite(n)) return 0;
  const rate = fxRates[locale.currencyCode];
  if (!Number.isFinite(rate) || rate === undefined || rate <= 0) {
    return Math.round(n);
  }
  return Math.round(n * rate);
}

/**
 * Format a money amount for display.
 *
 * We *intentionally* don't use `locale.numberFmt` here. Brazilian
 * Portuguese (`pt-BR`) and Indonesian (`id-ID`) both use `.` as the
 * thousands separator and `,` as the decimal point — so a converted
 * value of 5,655,000 IDR renders as `"5.655.000"`, which any
 * English-trained eye misreads as "five point six five five" rather
 * than "five million". The same applies to BR: `"1.740"` reads as
 * decimal in most non-CIS / non-EU regions.
 *
 * Standardising money to the en-US convention (comma thousands,
 * period decimal) keeps the displayed value unambiguous to an
 * international audience without giving up locale-native text
 * elsewhere in the UI (dates, button labels, market questions all
 * still use `locale.numberFmt` / `locale.lang`).
 */
function formatMoney(amount: number): string {
  return amount.toLocaleString("en-US");
}

type Strings = Partial<Record<string, string>>;
const STRINGS: Record<LangCode, Strings> = {
  en: {
    nav_coins: "coins",
    greeting_hi: "Hi,",
    greeting_sub:
      "Three games. One wallet. Pick where the money's moving — your last move's still warm.",
    g1_kind: "Lowest unique bid", g1_title: "Live Auctions", g1_status: "JACKPOT OPEN",
    g1_loading: "Loading featured auction…", g1_ends_in: "ends in",
    g1_retail: "Retail value", g1_cta: "Place bid",
    g2_kind: "Crash · Multiplier", g2_title: "Aviator", g2_live: "LIVE",
    g2_in_flight: "In flight", g2_players: "players", g2_cta: "Take off",
    g3_kind: "Prediction markets", g3_title: "Kalki Exchange", g3_status: "TRENDING",
    g3_loading: "Loading trending market…", g3_yes: "YES", g3_no: "NO",
    g3_liquidity: "Liquidity", g3_traders: "Traders", g3_closes: "Closes in", g3_cta: "Take a side",
    wallet_label: "Your wallet", wallet_same: "same balance across all three games",
    wallet_coins_unit: "coins", wallet_topup_from: "top up from", wallet_today: "today",
    wallet_topup: "Top up", wallet_cashout: "Cash out",
    hot_now: "Hot right now",
    activity_title: "Your recent moves", activity_link: "See all →",
    community_title: "Community wins", community_meta: "last 60s",
    footer_legal:
      "Play responsibly. 18+. Outcomes are not guaranteed. Stop when it stops being fun.",
    act_won_aviator: "Won Aviator at", act_lost_aviator: "Crashed Aviator at",
    act_predict_yes: "YES on", act_bid_placed: "Bid placed on",
    act_ago_min: "min ago", act_ago_hr: "h ago",
    com_won: "won",
  },
  pt: {
    nav_coins: "moedas",
    greeting_hi: "Olá,",
    greeting_sub: "Três jogos. Uma carteira. Escolha onde o dinheiro se move.",
    g1_kind: "Lance único mais baixo", g1_title: "Leilões ao vivo", g1_status: "JACKPOT ABERTO",
    g1_loading: "Carregando leilão em destaque…", g1_ends_in: "termina em",
    g1_retail: "Valor de varejo", g1_cta: "Dar lance",
    g2_kind: "Crash · Multiplicador", g2_title: "Aviator", g2_live: "AO VIVO",
    g2_in_flight: "Em voo", g2_players: "jogadores", g2_cta: "Decolar",
    g3_kind: "Mercados de previsão", g3_title: "Kalki Exchange", g3_status: "EM ALTA",
    g3_loading: "Carregando mercado em alta…", g3_yes: "SIM", g3_no: "NÃO",
    g3_liquidity: "Liquidez", g3_traders: "Traders", g3_closes: "Fecha em", g3_cta: "Escolher lado",
    wallet_label: "Sua carteira", wallet_same: "mesmo saldo nos três jogos",
    wallet_coins_unit: "moedas", wallet_topup_from: "recarregue a partir de", wallet_today: "hoje",
    wallet_topup: "Recarregar", wallet_cashout: "Sacar",
    hot_now: "Quente agora",
    activity_title: "Suas jogadas recentes", activity_link: "Ver tudo →",
    community_title: "Vitórias da comunidade", community_meta: "últimos 60s",
    footer_legal: "Jogue com responsabilidade. 18+. Resultados não garantidos.",
    com_won: "ganhou",
  },
  es: {
    nav_coins: "monedas",
    greeting_hi: "Hola,",
    greeting_sub: "Tres juegos. Una billetera. Elige dónde se mueve el dinero.",
    g1_kind: "Puja única más baja", g1_title: "Subastas en vivo", g1_status: "JACKPOT ABIERTO",
    g1_loading: "Cargando subasta destacada…", g1_ends_in: "termina en",
    g1_retail: "Precio retail", g1_cta: "Pujar",
    g2_kind: "Crash · Multiplicador", g2_title: "Aviator", g2_live: "EN VIVO",
    g2_in_flight: "En vuelo", g2_players: "jugadores", g2_cta: "Despegar",
    g3_kind: "Mercados de predicción", g3_title: "Kalki Exchange", g3_status: "TENDENCIA",
    g3_loading: "Cargando mercado en tendencia…", g3_yes: "SÍ", g3_no: "NO",
    g3_liquidity: "Liquidez", g3_traders: "Traders", g3_closes: "Cierra en", g3_cta: "Elegir lado",
    wallet_label: "Tu billetera", wallet_same: "mismo saldo en los tres juegos",
    wallet_coins_unit: "monedas", wallet_topup_from: "recarga desde", wallet_today: "hoy",
    wallet_topup: "Recargar", wallet_cashout: "Retirar",
    hot_now: "En tendencia",
    activity_title: "Tus jugadas recientes", activity_link: "Ver todo →",
    community_title: "Triunfos de la comunidad", community_meta: "últimos 60s",
    footer_legal: "Juega con responsabilidad. +18. Los resultados no están garantizados.",
    com_won: "ganó",
  },
  fr: {
    nav_coins: "jetons",
    greeting_hi: "Salut,",
    greeting_sub: "Trois jeux. Un seul portefeuille. Allez là où l’argent bouge.",
    g1_kind: "Enchère unique la plus basse", g1_title: "Enchères live", g1_status: "JACKPOT OUVERT",
    g1_loading: "Chargement de l’enchère à la une…", g1_ends_in: "fin dans",
    g1_retail: "Prix public", g1_cta: "Enchérir",
    g2_kind: "Crash · Multiplicateur", g2_title: "Aviator", g2_live: "EN DIRECT",
    g2_in_flight: "En vol", g2_players: "joueurs", g2_cta: "Décoller",
    g3_kind: "Marchés de prédiction", g3_title: "Kalki Exchange", g3_status: "TENDANCE",
    g3_loading: "Chargement du marché tendance…", g3_yes: "OUI", g3_no: "NON",
    g3_liquidity: "Liquidité", g3_traders: "Traders", g3_closes: "Ferme dans", g3_cta: "Choisir un camp",
    wallet_label: "Votre portefeuille", wallet_same: "même solde sur les trois jeux",
    wallet_coins_unit: "jetons", wallet_topup_from: "recharge dès", wallet_today: "aujourd’hui",
    wallet_topup: "Recharger", wallet_cashout: "Retirer",
    hot_now: "Tendance",
    activity_title: "Vos derniers coups", activity_link: "Voir tout →",
    community_title: "Gains de la communauté", community_meta: "60 dernières s",
    footer_legal: "Jouez responsable. 18+. Résultats non garantis.",
    com_won: "a gagné",
  },
  ru: {
    nav_coins: "монет",
    greeting_hi: "Привет,",
    greeting_sub: "Три игры. Один кошелёк. Иди туда, где деньги движутся.",
    g1_kind: "Уникальная мин. ставка", g1_title: "Аукционы", g1_status: "ДЖЕКПОТ",
    g1_loading: "Загружаем главный аукцион…", g1_ends_in: "до конца",
    g1_retail: "Розн. цена", g1_cta: "Поставить",
    g2_kind: "Краш · Множитель", g2_title: "Aviator", g2_live: "ОНЛАЙН",
    g2_in_flight: "В полёте", g2_players: "игроков", g2_cta: "Взлетать",
    g3_kind: "Прогнозные рынки", g3_title: "Kalki Exchange", g3_status: "В ТРЕНДЕ",
    g3_loading: "Загружаем рынок в тренде…", g3_yes: "ДА", g3_no: "НЕТ",
    g3_liquidity: "Ликвидность", g3_traders: "Трейдеров", g3_closes: "Закрытие", g3_cta: "Выбрать сторону",
    wallet_label: "Твой кошелёк", wallet_same: "один баланс на все три игры",
    wallet_coins_unit: "монет", wallet_topup_from: "пополни от", wallet_today: "сегодня",
    wallet_topup: "Пополнить", wallet_cashout: "Вывести",
    hot_now: "Горячее сейчас",
    activity_title: "Твои недавние ходы", activity_link: "Все →",
    community_title: "Выигрыши сообщества", community_meta: "последние 60с",
    footer_legal: "Играй ответственно. 18+. Результаты не гарантированы.",
    com_won: "выиграл",
  },
  zh: {
    nav_coins: "金币",
    greeting_hi: "嗨，",
    greeting_sub: "三款游戏，一个钱包。去钱在流动的地方。",
    g1_kind: "最低唯一出价", g1_title: "实时竞拍", g1_status: "大奖开放",
    g1_loading: "正在加载精选竞拍…", g1_ends_in: "剩余",
    g1_retail: "零售价", g1_cta: "出价",
    g2_kind: "崩盘 · 倍率", g2_title: "Aviator", g2_live: "直播中",
    g2_in_flight: "飞行中", g2_players: "名玩家", g2_cta: "起飞",
    g3_kind: "预测市场", g3_title: "Kalki Exchange", g3_status: "热门",
    g3_loading: "正在加载热门市场…", g3_yes: "是", g3_no: "否",
    g3_liquidity: "流动性", g3_traders: "交易者", g3_closes: "截止", g3_cta: "选边",
    wallet_label: "你的钱包", wallet_same: "三个游戏共用同一个余额",
    wallet_coins_unit: "金币", wallet_topup_from: "充值最低", wallet_today: "今日",
    wallet_topup: "充值", wallet_cashout: "提现",
    hot_now: "正在热门",
    activity_title: "你的近期操作", activity_link: "查看全部 →",
    community_title: "社区赢家", community_meta: "近 60 秒",
    footer_legal: "理性娱乐。18 岁以上。结果不保证。",
    com_won: "赢得",
  },
  id: {
    nav_coins: "koin",
    greeting_hi: "Halo,",
    greeting_sub: "Tiga game. Satu dompet. Pilih di mana uang bergerak.",
    g1_kind: "Bid unik terendah", g1_title: "Lelang Live", g1_status: "JACKPOT TERBUKA",
    g1_loading: "Memuat lelang unggulan…", g1_ends_in: "berakhir dalam",
    g1_retail: "Harga retail", g1_cta: "Pasang bid",
    g2_kind: "Crash · Pengganda", g2_title: "Aviator", g2_live: "LIVE",
    g2_in_flight: "Mengudara", g2_players: "pemain", g2_cta: "Lepas landas",
    g3_kind: "Pasar prediksi", g3_title: "Kalki Exchange", g3_status: "TREN",
    g3_loading: "Memuat pasar yang sedang tren…", g3_yes: "YA", g3_no: "TIDAK",
    g3_liquidity: "Likuiditas", g3_traders: "Trader", g3_closes: "Tutup dalam", g3_cta: "Pilih sisi",
    wallet_label: "Dompetmu", wallet_same: "saldo sama di tiga game",
    wallet_coins_unit: "koin", wallet_topup_from: "isi ulang mulai", wallet_today: "hari ini",
    wallet_topup: "Isi ulang", wallet_cashout: "Cairkan",
    hot_now: "Lagi panas",
    activity_title: "Gerakan terbarumu", activity_link: "Lihat semua →",
    community_title: "Kemenangan komunitas", community_meta: "60 dtk terakhir",
    footer_legal: "Main bertanggung jawab. 18+. Hasil tidak dijamin.",
    com_won: "menang",
  },
};

function T(key: string, lang: LangCode): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? "";
}

// Stereotypically-common usernames per region, used by the rolling
// "community wins" panel. Pulls home region first then 2 winners per
// other region for a global feel.
const WINNERS_BY_REGION: Record<CountryCode, string[]> = {
  IN: ["🇮🇳 arjun.eth", "🇮🇳 priya.bid", "🇮🇳 rohan_b", "🇮🇳 meera.x", "🇮🇳 nikhil_27", "🇮🇳 ananya.42", "🇮🇳 shreya_k", "🇮🇳 tanmay.io"],
  BR: ["🇧🇷 joao_silva", "🇧🇷 beatriz.r", "🇧🇷 lucas.aviator", "🇧🇷 mateus_88", "🇧🇷 camila.bid", "🇧🇷 ana.crash"],
  FR: ["🇫🇷 camille_42", "🇫🇷 lucas.fr", "🇫🇷 sophie.b", "🇫🇷 mathieu_p", "🇫🇷 julie.crash", "🇫🇷 antoine.k"],
  RU: ["🇷🇺 ivan.k", "🇷🇺 anastasia", "🇷🇺 dmitry_42", "🇷🇺 ekaterina.x", "🇷🇺 sergey.bid", "🇷🇺 alexei_99"],
  PH: ["🇵🇭 mark.ph", "🇵🇭 angel_42", "🇵🇭 jovito.bid", "🇵🇭 nina.x", "🇵🇭 paolo_88", "🇵🇭 trisha.k"],
  CN: ["🇨🇳 wei_lin", "🇨🇳 mei.x", "🇨🇳 hao_42", "🇨🇳 jing.bid", "🇨🇳 yu_chen", "🇨🇳 zhao.k"],
  MX: ["🇲🇽 diego_mx", "🇲🇽 sofia.b", "🇲🇽 mateo.42", "🇲🇽 valeria.x", "🇲🇽 santiago.k", "🇲🇽 regina.bid"],
  ID: ["🇮🇩 budi.id", "🇮🇩 sari_42", "🇮🇩 ahmad.x", "🇮🇩 rina.bid", "🇮🇩 dewi.k", "🇮🇩 hendra_88"],
  NG: ["🇳🇬 chidi_ng", "🇳🇬 ade.bid", "🇳🇬 ifeoma.x", "🇳🇬 emeka_42", "🇳🇬 funke.k", "🇳🇬 tunde.crash"],
  AE: ["🇦🇪 ahmed.uae", "🇦🇪 fatima.x", "🇦🇪 omar_42", "🇦🇪 layla.bid", "🇦🇪 khalid.k", "🇦🇪 mariam.crash"],
  US: ["🇺🇸 jake_t", "🇺🇸 ashley.x", "🇺🇸 marcus.42", "🇺🇸 chloe.k", "🇺🇸 ethan_88", "🇺🇸 mia.bid"],
};

function buildMixedWinners(home: CountryCode): string[] {
  const local = WINNERS_BY_REGION[home] ?? WINNERS_BY_REGION.IN;
  const others = (Object.entries(WINNERS_BY_REGION) as [CountryCode, string[]][])
    .filter(([k]) => k !== home)
    .flatMap(([, arr]) => arr.slice(0, 2));
  return [...local, ...others];
}

const LOCALE_COOKIE = "kalki_locale";

export interface HubAuction {
  id: string;
  title: string;
  imageUrl: string | null;
  retailPrice: string;
  endsAt: string;
  /** Localized detail-page URL, pre-resolved on the server so client
   *  code doesn't have to thread the URL `locale` through every chip
   *  render. Typically `/en/auctions/{id}`, `/pt/auctions/{id}`, … */
  href: string;
}

export interface HubMarket {
  id: string;
  slug: string;
  title: string;
  yesCents: number;
  noCents: number;
  liquidityCoins: number;
  traders: number;
  endsAt: string;
}

export interface HubLinks {
  /** Detail URL for the featured auction (deep-link from "Place bid"). */
  auction: string;
  /** Generic auctions catalog URL (used as a fallback). */
  auctionsList: string;
  /** Aviator deep-link, already carrying ?token=… for SSO. */
  aviator: string;
  /** Exchange deep-link for the featured market (or root if none). */
  exchange: string;
  /** Wallet (top up + cash out) — points at the exchange wallet. */
  wallet: string;
  /** Hub itself (brand-mark target). Locale-prefixed by the server so
   *  navigating "home" doesn't drop the user out of their locale tree. */
  home: string;
  /** Locale-prefixed `/me/watchlist`. */
  watchlist: string;
  /** Locale-prefixed `/notifications`. */
  notifications: string;
  /** Locale-prefixed `/profile`. */
  profile: string;
}

export interface HubClientProps {
  initialCountry: CountryCode;
  user: {
    username: string;
    coinBalance: number;
    isAdmin: boolean;
  };
  auction: HubAuction | null;
  market: HubMarket | null;
  links: HubLinks;
  /** Recent live auctions surfaced as "Hot right now" chips. Server
   *  pre-shuffles so each page render highlights a different mix. */
  recentAuctions: HubAuction[];
  /** Top trending markets surfaced as chips alongside the auctions. */
  recentMarkets: HubMarket[];
  /** INR-base FX rate table, fetched server-side from Frankfurter
   *  (yesterday's ECB close) with Open ER API as fallback for
   *  currencies ECB doesn't cover. Empty object when both upstreams
   *  fail — `convertFromINR` then renders the raw INR figure as-is. */
  fxRates: Partial<Record<string, number>>;
  /** PPP-based local-currency value of the wallet balance, computed
   *  server-side as balance × (1000-coin pack price / 1000) for the
   *  user's region. null when no pricing is published — the widget
   *  then shows coins only. Reflects the SSR-resolved country; an
   *  in-page country switch updates it on the next refresh. */
  coinValue?: string | null;
}

/** True for `http(s)://...` URLs — used to decide whether the game
 *  card / chip should open in a new tab (cross-origin SSO into Aviator
 *  / Exchange / Admin) or stay in-tab (local route in this app). */
function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function externalAttrs(href: string): { target?: "_blank"; rel?: string } {
  return isExternal(href)
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
}

function formatHMS(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}

function relativeMin(min: number, lang: LangCode): string {
  if (min < 60) return `${min} ${T("act_ago_min", lang) || "min ago"}`;
  return `${Math.floor(min / 60)} ${T("act_ago_hr", lang) || "h ago"}`;
}

interface Activity {
  kind: "win" | "loss" | "open" | "bid";
  k: string;
  tail: string;
  amt: string;
  mins: number;
  game: string;
  open?: boolean;
}

const SAMPLE_ACTIVITY: Activity[] = [
  { kind: "win", k: "act_won_aviator", tail: "8.42x", amt: "+2,420", mins: 14, game: "AVIATOR" },
  { kind: "open", k: "act_predict_yes", tail: "BTC > $74k", amt: "420", mins: 42, game: "EXCHANGE", open: true },
  { kind: "loss", k: "act_lost_aviator", tail: "1.18x", amt: "-200", mins: 88, game: "AVIATOR" },
  { kind: "bid", k: "act_bid_placed", tail: "iPhone 17 Pro Max", amt: "1", mins: 142, game: "AUCTIONS", open: true },
  { kind: "win", k: "act_won_aviator", tail: "4.81x", amt: "+1,200", mins: 220, game: "AVIATOR" },
];

/* ============================================================
   ACTIVITY ICONS — extracted as standalone components so each
   row in the activity panel renders the right glyph without an
   inline switch in the JSX.
   ============================================================ */
function ActivityIcon({ kind }: { kind: Activity["kind"] }) {
  if (kind === "win")
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="ic-sm"><path d="M7 14l5-5 5 5" /></svg>;
  if (kind === "loss")
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="ic-sm"><path d="M7 10l5 5 5-5" /></svg>;
  if (kind === "open")
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ic-sm"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ic-sm"><path d="M14 3l3 4-3 4M17 7H7v10h10" /></svg>;
}

/* ============================================================
   AVIATOR MINI — same engine as the design's Hub.html, ported
   to React. Runs entirely in the browser; pauses while the tab
   is hidden so we don't burn CPU in background tabs.
   ============================================================ */
function AviatorMini() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<SVGPathElement | null>(null);
  const fillRef = useRef<SVGPathElement | null>(null);
  const horseRef = useRef<HTMLDivElement | null>(null);
  const multRef = useRef<HTMLSpanElement | null>(null);
  const playersRef = useRef<HTMLSpanElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const W = 320, H = 56;
    const rand = (a: number, b: number) => Math.random() * (b - a) + a;
    let mult = 1;
    let busted = false;
    let crashAt = 0;
    let startedAt = 0;
    let history: { t: number; m: number }[] = [];
    let raf = 0;
    let resetTimeout: ReturnType<typeof setTimeout> | undefined;

    function startRound() {
      mult = 1.0;
      busted = false;
      crashAt = Math.max(1.2, Math.pow(rand(0, 1), 1.7) * 28 + 1.2);
      startedAt = performance.now();
      history = [{ t: 0, m: 1 }];
      wrapRef.current?.classList.remove("busted");
      if (playersRef.current) playersRef.current.textContent = String(Math.floor(rand(280, 620)));
    }
    function bust() {
      busted = true;
      wrapRef.current?.classList.add("busted");
      lineRef.current?.setAttribute("stroke", "#FF4D6D");
      fillRef.current?.setAttribute("fill", "url(#khub-avFillRed)");
      horseRef.current?.classList.add("busted");
      horseRef.current?.querySelectorAll("svg").forEach((s) => s.setAttribute("fill", "#FF4D6D"));
      resetTimeout = setTimeout(() => {
        lineRef.current?.setAttribute("stroke", "#22D3EE");
        fillRef.current?.setAttribute("fill", "url(#khub-avFill)");
        horseRef.current?.classList.remove("busted");
        horseRef.current?.querySelectorAll("svg").forEach((s) => s.setAttribute("fill", "#22D3EE"));
        startRound();
      }, 1400);
    }
    function draw() {
      if (history.length === 0) return;
      const tMax = Math.max(6, history[history.length - 1].t);
      const mMax = Math.max(2.2, history[history.length - 1].m * 1.1);
      let d = "";
      for (let i = 0; i < history.length; i++) {
        const p = history[i];
        const x = (p.t / tMax) * W;
        const y = H - ((p.m - 1) / (mMax - 1)) * (H - 6) - 3;
        d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
      }
      lineRef.current?.setAttribute("d", d);
      const last = history[history.length - 1];
      const lx = (last.t / tMax) * W;
      const ly = H - ((last.m - 1) / (mMax - 1)) * (H - 6) - 3;
      const svgEl = svgRef.current;
      if (svgEl && horseRef.current) {
        const rect = svgEl.getBoundingClientRect();
        const px = (lx / W) * rect.width;
        const py = (ly / H) * rect.height;
        let angle = 0;
        if (history.length >= 2) {
          const pp = history[history.length - 2];
          const ppx = ((pp.t / tMax) * W * rect.width) / W;
          const ppy = ((H - ((pp.m - 1) / (mMax - 1)) * (H - 6) - 3) / H) * rect.height;
          angle = (Math.atan2(py - ppy, px - ppx) * 180) / Math.PI;
        }
        horseRef.current.style.transform = `translate(${(px - 12).toFixed(1)}px, ${(py - 9).toFixed(1)}px) rotate(${angle.toFixed(1)}deg)`;
      }
      fillRef.current?.setAttribute("d", d + " L " + lx.toFixed(1) + " " + H + " L 0 " + H + " Z");
    }
    function tick() {
      if (document.hidden) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (busted) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = (performance.now() - startedAt) / 1000;
      mult = Math.pow(1.07, t * 4);
      if (mult >= crashAt) {
        mult = crashAt;
        if (multRef.current) multRef.current.textContent = mult.toFixed(2);
        draw();
        bust();
        raf = requestAnimationFrame(tick);
        return;
      }
      if (multRef.current) multRef.current.textContent = mult.toFixed(2);
      history.push({ t, m: mult });
      if (history.length > 200) history.shift();
      draw();
      raf = requestAnimationFrame(tick);
    }

    startRound();
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (resetTimeout) clearTimeout(resetTimeout);
    };
  }, []);

  return (
    <div className="game-viz">
      <div className="aviator-mult" ref={wrapRef}>
        <span ref={multRef}>1.00</span>
        <span className="x">x</span>
      </div>
      <div className="aviator-mini">
        <svg ref={svgRef} viewBox="0 0 320 56" preserveAspectRatio="none">
          <defs>
            <linearGradient id="khub-avFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="khub-avFillRed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF4D6D" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#FF4D6D" stopOpacity="0" />
            </linearGradient>
            <filter id="khub-avGlow">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path ref={fillRef} d="M0 56 L0 56 Z" fill="url(#khub-avFill)" />
          <path ref={lineRef} d="M0 56" stroke="#22D3EE" strokeWidth="2" fill="none" filter="url(#khub-avGlow)" />
        </svg>
        <div className="av-horse-overlay" ref={horseRef} aria-hidden>
          <svg viewBox="0 0 120 90" fill="#22D3EE">
            <path d="M 30 26 L 4 14 L 32 34 Z" opacity="0.50" />
            <path d="M 28 46 L 2 46 L 32 56 Z" opacity="0.32" />
            <path d="M 22 88 L 22 60 Q 22 46 30 38 Q 30 28 34 20 L 28 4 L 44 16 Q 54 18 60 26 L 84 34 L 106 40 L 108 48 L 98 50 Q 88 54 78 54 Q 66 56 62 62 L 60 88 Z" />
            <circle cx="76" cy="38" r="1.6" fill="#020617" />
          </svg>
        </div>
      </div>
      <span ref={playersRef} style={{ display: "none" }}>412</span>
    </div>
  );
}

/* Tiny helper — Aviator "in flight" counter rendered as a label
 * next to the CTA. Kept separate from the canvas to avoid re-
 * rendering the canvas on every player-count tick. */
function PlayersCounter() {
  const [n, setN] = useState(412);
  useEffect(() => {
    const id = setInterval(() => setN(Math.floor(Math.random() * 340 + 280)), 4000);
    return () => clearInterval(id);
  }, []);
  return <span>{n.toLocaleString("en-IN")}</span>;
}

export function HubClient({
  initialCountry,
  user,
  auction,
  market,
  links,
  recentAuctions,
  recentMarkets,
  fxRates,
  coinValue,
}: HubClientProps) {
  const [country, setCountry] = useState<CountryCode>(initialCountry);
  const [locMenuOpen, setLocMenuOpen] = useState(false);
  const locale = LOCALES[country];
  const lang = locale.lang;
  const tr = (k: string) => T(k, lang);

  // Countdowns tick locally so the page doesn't have to re-render on
  // the server every second. Both reset when the upstream payload
  // updates the underlying timestamp.
  const auctionEndsAt = auction ? new Date(auction.endsAt).getTime() : 0;
  const marketEndsAt = market ? new Date(market.endsAt).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const auctionRemaining = auctionEndsAt ? formatHMS(auctionEndsAt - now) : "—";
  const marketRemaining = marketEndsAt ? formatHMS(marketEndsAt - now) : "—";

  // Persist the user's locale choice in a 1-year cookie so the next
  // visit lands on the same locale (same key the login page reads).
  function applyCountry(c: CountryCode) {
    setCountry(c);
    setLocMenuOpen(false);
    if (typeof document !== "undefined") {
      const maxAge = 60 * 60 * 24 * 365;
      document.cookie = `${LOCALE_COOKIE}=${c}; path=/; max-age=${maxAge}; samesite=lax`;
    }
  }

  // Close the locale menu on outside clicks (no portal — the menu is
  // absolutely positioned and lives inside the nav).
  useEffect(() => {
    if (!locMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const menu = document.getElementById("khub-loc-menu");
      const btn = document.getElementById("khub-loc-btn");
      if (menu?.contains(t) || btn?.contains(t)) return;
      setLocMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [locMenuOpen]);

  // Wallet balance is the SSR-resolved truth — render it verbatim.
  //
  // (Previous version drifted the displayed number by ±50–80 every
  //  ~4s "to feel alive". That's fine for a fictional ticker but
  //  catastrophic for a wallet: the user's eye lands on the chip,
  //  sees a number that doesn't match what they spent or earned,
  //  thinks the app glitched. Removed.)
  //
  // When a write changes the balance (top-up, bet placed, auction
  // bid), the calling page issues a `router.refresh()` which causes
  // the server component above to re-fetch /auth/me and pass a
  // fresh `user.coinBalance` prop down here, so the value updates
  // without a polling loop.
  // Coin balance is displayed adjacent to the locale currency symbol
  // (wallet equiv line: "≈ ₹ <balance>"), so the BR/ID `.`-as-
  // thousands ambiguity bites here too. Use the universal `,`
  // thousands grouping.
  const balDisplay = formatMoney(user.coinBalance);
  const handleInitials = useMemo(() => {
    const name = user.username.replace(/[^A-Za-z0-9]/g, "");
    return name.slice(0, 2).toUpperCase() || "U";
  }, [user.username]);

  // ============ Ticker ============
  const tickerItems = useMemo(() => {
    const pool = buildMixedWinners(country).slice(0, 14);
    const games = ["AVIATOR", "PREDICT", "AUCTION"];
    const amounts = [locale.samples.liquidity, locale.samples.retailValue, "4,820", "12,400", "2,400"];
    return pool.map((who, i) => {
      const flagMatch = who.match(/\p{Emoji}+/u);
      const flag = flagMatch ? flagMatch[0] : "🌐";
      const name = who.replace(/^\p{Emoji}+\s*/u, "").trim();
      const game = games[i % games.length];
      const amt = `${locale.currency} ${amounts[i % amounts.length]}`;
      return { flag, name, game, amt };
    });
  }, [country, locale]);

  return (
    <div className="khub" lang={lang}>
      <div className="khub-bg" aria-hidden>
        <div className="khub-bg-mesh" />
        <div className="khub-orb a" />
        <div className="khub-orb b" />
        <div className="khub-bg-grid" />
        <div className="khub-bg-grain" />
      </div>

      <div className="khub-page">
        {/* ========== NAV ========== */}
        <nav className="nav">
          <a className="brand" href={links.home}>
            {/* Kalki warrior-on-horse mark. File lives at
                auctions/public/kalki-mark.png, served at /kalki-mark.png. */}
            <span className="brand-mark" aria-label="Kalki logo">
              <img
                src="/kalki-mark.png"
                alt=""
                width={106}
                height={106}
                style={{ objectFit: "contain" }}
              />
            </span>
            {/* Wordmark removed — "KALKI" is baked into the PNG. */}
          </a>

          <div className="nav-right">
            <a className="wallet-pill" href={links.wallet} aria-label="Wallet" {...externalAttrs(links.wallet)}>
              <span className="amt">{balDisplay}</span>
              <span>{tr("nav_coins")}</span>
              <span className="plus" aria-label="Top up">+</span>
            </a>

            <a className="icon-btn" href={links.watchlist} aria-label="Watchlist">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="ic">
                <path d="M12 17.3l-6.2 3.7 1.7-7L2 9.3l7.2-.6L12 2l2.8 6.7 7.2.6-5.5 4.7 1.7 7z" />
              </svg>
            </a>

            <a className="icon-btn" href={links.notifications} aria-label="Notifications">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="ic">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </a>

            <div className="loc">
              <button
                id="khub-loc-btn"
                className="loc-btn"
                aria-haspopup="listbox"
                onClick={() => setLocMenuOpen((v) => !v)}
              >
                <span className="loc-flag">{locale.flag}</span>
                <span className="loc-code">{country} · {locale.currency.trim()}</span>
                <span className="loc-caret">▾</span>
              </button>
              <div id="khub-loc-menu" className={`loc-menu${locMenuOpen ? " open" : ""}`} role="listbox">
                {(Object.entries(LOCALES) as [CountryCode, Locale][]).map(([code, L]) => (
                  <button
                    key={code}
                    type="button"
                    className={`loc-item${code === country ? " active" : ""}`}
                    onClick={() => applyCountry(code)}
                  >
                    <span className="flag">{L.flag}</span>
                    <span className="name">{L.name}</span>
                    <span className="meta">{code} · {L.currency.trim()}</span>
                  </button>
                ))}
              </div>
            </div>

            <a className="avatar" href={links.profile} aria-label="Profile">
              {handleInitials}
            </a>
          </div>
        </nav>

        {/* ========== GREETING ========== */}
        <section className="greeting fade-in">
          <div className="greeting-row">
            <div>
              <h1>
                <span>{tr("greeting_hi")} </span>
                <span className="at">@</span>
                <span className="name">{user.username}</span>
                {user.isAdmin && <span className="admin-pill">Admin</span>}
              </h1>
              <p className="sub">{tr("greeting_sub")}</p>
            </div>
          </div>
        </section>

        {/* ========== 3 LIVE GAME CARDS ========== */}
        <section className="games">

          {/* AUCTIONS */}
          <a className="game auctions" href={links.auction} tabIndex={0} {...externalAttrs(links.auction)}>
            <div className="game-top">
              <div className="game-tag">
                <div className="game-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="ic">
                    <path d="M3 7h2l2 12h10l2-9H7" />
                    <circle cx="9" cy="21" r="1.5" />
                    <circle cx="17" cy="21" r="1.5" />
                    <path d="M14 3l3 4-3 4M17 7H9" />
                  </svg>
                </div>
                <div>
                  <div className="game-kind">{tr("g1_kind")}</div>
                  <div className="game-title">{tr("g1_title")}</div>
                </div>
              </div>
              <span className="game-status gold">{tr("g1_status")}</span>
            </div>

            <div className="game-viz">
              <div className="auction-item">
                <div className="auction-img">
                  {auction?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={auction.imageUrl} alt="" />
                  ) : (
                    <span>{auction ? "🛒" : "📦"}</span>
                  )}
                </div>
                <div className="auction-info">
                  <div className="auction-name" style={auction ? undefined : { opacity: 0.5 }}>
                    {auction ? auction.title : tr("g1_loading")}
                  </div>
                  <div className="auction-time">
                    <span className="clk" />
                    <span>{tr("g1_ends_in")}</span>
                    &nbsp;<span>{auctionRemaining}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="game-foot">
              <div className="meta">
                <div className="meta-label">{tr("g1_retail")}</div>
                <div className="meta-value">
                  <span>{locale.currency}</span>
                  {/* retailPrice is INR on the backend — convert to
                      the selected locale's currency so the displayed
                      number agrees with the shown symbol. Formatted
                      with `,` thousands / `.` decimal regardless of
                      locale to avoid the BR/ID `.`-as-thousands
                      ambiguity (see formatMoney for rationale). */}
                  <span>
                    {auction
                      ? formatMoney(convertFromINR(auction.retailPrice, locale, fxRates))
                      : "—"}
                  </span>
                </div>
              </div>
              <span className="game-cta">
                <span>{tr("g1_cta")}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="ic-sm">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </a>

          {/* AVIATOR */}
          <a className="game aviator" href={links.aviator} tabIndex={0} {...externalAttrs(links.aviator)}>
            <div className="game-top">
              <div className="game-tag">
                <div className="game-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="ic">
                    <path d="M21 16v-2l-8-5V3.5C13 2.7 12.3 2 11.5 2S10 2.7 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5l8 2.5z" />
                  </svg>
                </div>
                <div>
                  <div className="game-kind">{tr("g2_kind")}</div>
                  <div className="game-title">{tr("g2_title")}</div>
                </div>
              </div>
              <span className="game-status live">
                <span className="live-dot" />
                <span>{tr("g2_live")}</span>
              </span>
            </div>

            <AviatorMini />

            <div className="game-foot">
              <div className="meta">
                <div className="meta-label">{tr("g2_in_flight")}</div>
                <div className="meta-value">
                  <PlayersCounter />
                  &nbsp;<span style={{ color: "var(--text-3)", fontSize: 12, fontWeight: 500 }}>{tr("g2_players")}</span>
                </div>
              </div>
              <span className="game-cta">
                <span>{tr("g2_cta")}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="ic-sm">
                  <path d="M7 17L17 7M17 7H9M17 7v8" />
                </svg>
              </span>
            </div>
          </a>

          {/* EXCHANGE */}
          <a className="game exchange" href={links.exchange} tabIndex={0} {...externalAttrs(links.exchange)}>
            <div className="game-top">
              <div className="game-tag">
                <div className="game-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="ic">
                    <path d="M3 17l6-6 4 4 8-8" />
                    <path d="M14 7h7v7" />
                  </svg>
                </div>
                <div>
                  <div className="game-kind">{tr("g3_kind")}</div>
                  <div className="game-title">{tr("g3_title")}</div>
                </div>
              </div>
              <span className="game-status blue">{tr("g3_status")}</span>
            </div>

            <div className="game-viz">
              <div className="exchange-q">
                <b style={market ? undefined : { opacity: 0.5 }}>
                  {market ? market.title : tr("g3_loading")}
                </b>
              </div>
              <div className="exchange-bars">
                <div className="ex-bar yes">
                  <span className="lbl">{tr("g3_yes")}</span>
                  {/* yesCents / noCents are 0–100 from the bet
                      backend (probability × 100). Display as 0.00-1.00
                      decimal — prediction-market convention. */}
                  <span>{market ? (market.yesCents / 100).toFixed(2) : "—"}</span>
                </div>
                <div className="ex-bar no">
                  <span className="lbl">{tr("g3_no")}</span>
                  <span>{market ? (market.noCents / 100).toFixed(2) : "—"}</span>
                </div>
              </div>
              <div className="ex-vol">
                <span>
                  <span>{tr("g3_liquidity")}</span>
                  &nbsp;<b>
                    <span>{locale.currency}</span>
                    {/* Money — universal `,` thousands format. */}
                    <span>{market ? formatMoney(market.liquidityCoins) : "—"}</span>
                  </b>
                </span>
                <span>
                  <span>{tr("g3_traders")}</span>
                  {/* Traders is a head count, not money — locale-
                      native grouping is fine (no currency symbol to
                      anchor on, so ambiguity doesn't bite). */}
                  &nbsp;<b>{market ? market.traders.toLocaleString(locale.numberFmt) : "—"}</b>
                </span>
              </div>
            </div>

            <div className="game-foot">
              <div className="meta">
                <div className="meta-label">{tr("g3_closes")}</div>
                <div className="meta-value">{marketRemaining}</div>
              </div>
              <span className="game-cta">
                <span>{tr("g3_cta")}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="ic-sm">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </a>
        </section>

        {/* ========== WALLET HERO ========== */}
        <section className="wallet">
          <div className="wallet-left">
            <div className="wallet-label">
              <span>{tr("wallet_label")}</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{tr("wallet_same")}</span>
            </div>
            <div className="wallet-balance">
              <span>{balDisplay}</span>
              <span className="unit">{tr("wallet_coins_unit")}</span>
            </div>
            <div className="wallet-equiv">
              {/* PPP-based value of the balance (what the user paid per
                  coin), computed server-side from the 1000-coin pack
                  price. Falls back to coins-only when unavailable. */}
              {coinValue ? (
                <>
                  ≈&nbsp;<b>{coinValue}</b>
                </>
              ) : (
                <span>
                  {balDisplay}&nbsp;{tr("wallet_coins_unit")}
                </span>
              )}
            </div>
          </div>
          <div className="wallet-actions">
            <a className="wallet-btn primary" href={links.wallet} {...externalAttrs(links.wallet)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="ic">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>{tr("wallet_topup")}</span>
            </a>
            <a className="wallet-btn" href={links.wallet} {...externalAttrs(links.wallet)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ic">
                <path d="M3 12h13M11 7l5 5-5 5" />
                <path d="M21 4v16" />
              </svg>
              <span>{tr("wallet_cashout")}</span>
            </a>
          </div>
        </section>

        {/* ========== HOT NOW chips ========== */}
        <section className="hot">
          <span className="hot-label">{tr("hot_now")}</span>
          {/* Live auctions get a gold dot; trending markets a blue one.
              We render up to 2 of each so the row stays scannable. */}
          {recentAuctions.slice(0, 2).map((a) => (
            <a key={a.id} className="hot-chip gold" href={a.href} {...externalAttrs(a.href)}>
              <span className="dot" />
              <span className="em">🛒</span>
              &nbsp;<span>{a.title}</span>
            </a>
          ))}
          {recentMarkets.slice(0, 2).map((m) => {
            const href = marketHref(m, links);
            return (
              <a key={m.id} className="hot-chip blue" href={href} {...externalAttrs(href)}>
                <span className="dot" />
                <span className="em">📈</span>
                &nbsp;<span>{m.title}</span>
              </a>
            );
          })}
        </section>

        {/* ========== ACTIVITY + COMMUNITY ========== */}
        <section className="below">
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">{tr("activity_title")}</div>
              <a className="panel-link" href={links.profile}>{tr("activity_link")}</a>
            </div>
            <div className="activity">
              {SAMPLE_ACTIVITY.map((a, i) => {
                const ago = relativeMin(a.mins, lang);
                const amtClass = a.open ? "open" : a.kind === "win" ? "win" : a.kind === "loss" ? "loss" : "open";
                const amtBody =
                  a.kind === "bid" || a.open
                    ? `${locale.currency}${a.amt.trim()}`
                    : `${a.amt} ${tr("nav_coins")}`;
                return (
                  <div className="activity-row" key={i}>
                    <div className={`activity-ic ${a.kind}`}>
                      <ActivityIcon kind={a.kind} />
                    </div>
                    <div className="activity-desc">
                      <span><b>{tr(a.k)}</b> {a.tail}</span>
                      <div className="meta">{a.game} · {ago}</div>
                    </div>
                    <div className={`activity-amt ${amtClass}`}>{amtBody}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">
                <span className="dot-pulse" />
                <span>{tr("community_title")}</span>
              </div>
              <span className="panel-link">{tr("community_meta")}</span>
            </div>
            <div className="ticker" aria-label="Community wins">
              {/* Duplicate the list so the vertical scroll animation can
                  loop seamlessly — the keyframes translate by exactly -50%. */}
              <div className="ticker-track-v">
                {[...tickerItems, ...tickerItems].map((it, i) => (
                  <div className="ticker-item" key={i}>
                    <div className="av">{it.flag}</div>
                    <div className="desc">
                      <b>{it.name}</b> {tr("com_won")} <span className="game">· {it.game}</span>
                    </div>
                    <div className="amt">{it.amt}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <p className="footer">{tr("footer_legal")}</p>
      </div>
    </div>
  );
}

/** Build an Exchange deep-link for a specific market. Falls back to the
 *  Exchange root if we don't have a slug — same hand-off shape (?token)
 *  the receiving app's TokenBridge expects. */
function marketHref(m: HubMarket, links: HubLinks): string {
  const root = links.exchange;
  // links.exchange already carries "?token=…" — splice the slug before it.
  const [base, qs] = root.split("?");
  const baseTrim = base.replace(/\/+$/, "");
  const path = `${baseTrim}/markets/${m.slug}`;
  return qs ? `${path}?${qs}` : path;
}

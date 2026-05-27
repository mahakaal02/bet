/**
 * Locale data for the hub login/landing page (PR-LOGIN-REDESIGN).
 *
 * Three datasets travel together because they're keyed off the same
 * country code:
 *
 *   • LOCALES — country → { language, currency symbol, flag, Intl
 *     locale tag, pre-formatted sample amounts in local digit
 *     grouping convention }
 *   • STRINGS — language → translation dictionary. en is canonical;
 *     missing keys fall back to en at render time via `getString()`.
 *   • WINNERS_BY_REGION — country → static roster of stereotypically-
 *     common usernames + flags. Surfaced in the rolling ticker and
 *     toasts to communicate "people like you are playing right now."
 *
 * Backend integration:
 *   • Server detects the country (see `lib/locale-detect.ts`) and
 *     passes it as the `initialCountry` prop to <LoginLanding/>.
 *   • Client-side, the user can override via the locale switcher
 *     dropdown; the choice writes the `kalki_locale` cookie so the
 *     next visit lands on the same locale.
 *   • If a real "recent winners" feed later replaces the static
 *     roster, just swap `buildMixedWinners()` to read from your
 *     event stream — the rendering layer is decoupled.
 */

export type CountryCode =
  | "IN"
  | "BR"
  | "FR"
  | "RU"
  | "PH"
  | "CN"
  | "MX"
  | "ID"
  | "NG"
  | "AE"
  | "US";

export type LanguageCode =
  | "en"
  | "pt"
  | "es"
  | "fr"
  | "ru"
  | "zh"
  | "id";

export interface LocaleConfig {
  /** Translation dictionary key — which language strings to show. */
  lang: LanguageCode;
  /** Currency glyph shown next to amounts. */
  currency: string;
  /** Emoji flag in the locale switcher. */
  flag: string;
  /** Native-language display name (so a user finds their language
   *  regardless of which one the page currently renders in). */
  name: string;
  /** IETF tag fed to `new Intl.NumberFormat(...)` for ticking counters. */
  numberFmt: string;
  /** Pre-formatted amounts in the locale's own digit-grouping
   *  convention. Used by the hero stats, market cards, ticker. */
  samples: {
    paidOut: string;
    bonus: string;
    liquidity: string;
    retailValue: string;
    pot: string;
  };
}

export const LOCALES: Record<CountryCode, LocaleConfig> = {
  IN: {
    lang: "en",
    currency: "₹",
    flag: "🇮🇳",
    name: "India",
    numberFmt: "en-IN",
    samples: {
      paidOut: "8,42,19,330",
      bonus: "100",
      liquidity: "14.2L",
      retailValue: "1,69,900",
      pot: "3,84,210",
    },
  },
  BR: {
    lang: "pt",
    currency: "R$",
    flag: "🇧🇷",
    name: "Brasil",
    numberFmt: "pt-BR",
    samples: {
      paidOut: "21.842.330",
      bonus: "50",
      liquidity: "38,2K",
      retailValue: "9.999",
      pot: "38.420",
    },
  },
  FR: {
    lang: "fr",
    currency: "€",
    flag: "🇫🇷",
    name: "France",
    numberFmt: "fr-FR",
    samples: {
      paidOut: "3 842 190",
      bonus: "10",
      liquidity: "142K",
      retailValue: "1 749",
      pot: "38 420",
    },
  },
  RU: {
    lang: "ru",
    currency: "₽",
    flag: "🇷🇺",
    name: "Россия",
    numberFmt: "ru-RU",
    samples: {
      paidOut: "38 421 900",
      bonus: "500",
      liquidity: "1,4 млн",
      retailValue: "149 990",
      pot: "384 210",
    },
  },
  PH: {
    lang: "en",
    currency: "₱",
    flag: "🇵🇭",
    name: "Philippines",
    numberFmt: "en-PH",
    samples: {
      paidOut: "5,842,330",
      bonus: "500",
      liquidity: "142K",
      retailValue: "89,990",
      pot: "38,420",
    },
  },
  CN: {
    lang: "zh",
    currency: "¥",
    flag: "🇨🇳",
    name: "中国",
    numberFmt: "zh-CN",
    samples: {
      paidOut: "842,193",
      bonus: "88",
      liquidity: "14.2万",
      retailValue: "12,999",
      pot: "38,420",
    },
  },
  MX: {
    lang: "es",
    currency: "MX$",
    flag: "🇲🇽",
    name: "México",
    numberFmt: "es-MX",
    samples: {
      paidOut: "1,842,330",
      bonus: "200",
      liquidity: "38K",
      retailValue: "28,999",
      pot: "38,420",
    },
  },
  ID: {
    lang: "id",
    currency: "Rp",
    flag: "🇮🇩",
    name: "Indonesia",
    numberFmt: "id-ID",
    samples: {
      paidOut: "184.219.330",
      bonus: "50.000",
      liquidity: "1,4M",
      retailValue: "24.999.000",
      pot: "3.842.100",
    },
  },
  NG: {
    lang: "en",
    currency: "₦",
    flag: "🇳🇬",
    name: "Nigeria",
    numberFmt: "en-NG",
    samples: {
      paidOut: "18,421,930",
      bonus: "5,000",
      liquidity: "380K",
      retailValue: "1,49,000",
      pot: "384,210",
    },
  },
  AE: {
    lang: "en",
    currency: "AED ",
    flag: "🇦🇪",
    name: "UAE",
    numberFmt: "en-AE",
    samples: {
      paidOut: "184,219",
      bonus: "10",
      liquidity: "14.2K",
      retailValue: "4,999",
      pot: "3,842",
    },
  },
  US: {
    lang: "en",
    currency: "$",
    flag: "🇺🇸",
    name: "United States",
    numberFmt: "en-US",
    samples: {
      paidOut: "420,890",
      bonus: "5",
      liquidity: "142K",
      retailValue: "1,199",
      pot: "4,820",
    },
  },
};

export type StringKey =
  | "nav_online_now"
  | "hero_eyebrow"
  | "headline_lead"
  | "headline_accent"
  | "headline_into"
  | "headline_strike"
  | "hero_subcopy"
  | "stat_paid_today"
  | "stat_players_online"
  | "stat_last_crash"
  | "stat_active_predictions"
  | "crash_round"
  | "crash_in"
  | "crash_pot"
  | "crash_cashout_window"
  | "crash_will_10x"
  | "login_joining_now"
  | "login_tab_login"
  | "login_tab_signup"
  | "login_title_login"
  | "login_sub_login"
  | "login_title_signup"
  | "login_sub_signup"
  | "login_continue_telegram"
  | "login_or"
  | "login_email_phone"
  | "login_password"
  | "login_show"
  | "login_hide"
  | "login_play_now"
  | "login_claim"
  | "login_forgot"
  | "login_have_account"
  | "login_trusted_by"
  | "login_takes"
  | "login_securing"
  | "login_2fa_title"
  | "login_2fa_sub"
  | "login_2fa_code"
  | "login_2fa_trust"
  | "login_2fa_submit"
  | "login_2fa_back"
  | "markets_title_a"
  | "markets_title_em"
  | "markets_title_b"
  | "markets_live"
  | "markets_settled"
  | "m1_kind"
  | "m1_status"
  | "m1_q"
  | "m1_yes"
  | "m1_no"
  | "m1_liquidity"
  | "m1_cta"
  | "m2_kind"
  | "m2_live"
  | "m2_q1"
  | "m2_q2"
  | "m2_in_flight"
  | "m2_players"
  | "m2_cta"
  | "m3_kind"
  | "m3_jackpot"
  | "m3_q_a"
  | "m3_q_won"
  | "m3_q_b"
  | "m3_retail"
  | "m3_cta"
  | "trust_countries"
  | "trust_countries_label"
  | "trust_payouts"
  | "trust_payouts_label"
  | "trust_action"
  | "trust_action_label"
  | "trust_players"
  | "trust_players_label"
  | "legal_responsible"
  | "ticker_just_won"
  | "ticker_ago"
  | "toast_cashed_out";

export const STRINGS: Record<LanguageCode, Partial<Record<StringKey, string>>> = {
  en: {
    nav_online_now: "online now",
    hero_eyebrow: "Now live in your country — 10+ markets, instant payouts",
    headline_lead: "Trade",
    headline_accent: "instinct",
    headline_into: "into winnings.",
    headline_strike: "Slow money.",
    hero_subcopy:
      "The market never sleeps. Neither do winners. Predict the next outcome, ride the crash, snipe the lowest unique bid — and cash out before everyone else does.",
    stat_paid_today: "Paid out till now",
    stat_players_online: "Players online",
    stat_last_crash: "Last crash",
    stat_active_predictions: "Active predictions",
    crash_round: "Round #",
    crash_in: "in",
    crash_pot: "Pot",
    crash_cashout_window: "Cashout window",
    crash_will_10x:
      "Will it 10× tonight? <b style=\"color:var(--text)\">418</b> say yes.",
    login_joining_now: "joining now",
    login_tab_login: "Log in",
    login_tab_signup: "Sign up",
    login_title_login: "Step into the market.",
    login_sub_login:
      "Smart players move first. Pick up where you left off — predictions, crash and unique-bid pots are live right now.",
    login_title_signup: "Don't watch. Win.",
    login_sub_signup:
      "Join 1.2M+ players. Free play on signup — no card required.",
    login_continue_telegram: "Continue with Telegram",
    login_or: "OR",
    login_email_phone: "Email or phone",
    login_password: "Password",
    login_show: "show",
    login_hide: "hide",
    login_play_now: "Play now",
    login_claim: "Claim & play",
    login_forgot: "Forgot password",
    login_have_account: "Have an account? Log in",
    login_trusted_by: "Trusted by 1.2M+ players",
    login_takes: "Takes ~12 seconds",
    login_securing: "Securing session…",
    login_2fa_title: "One more step.",
    login_2fa_sub:
      "2FA is on for this account. Enter the 6-digit code from your authenticator or an 8-character backup code.",
    login_2fa_code: "Verification code",
    login_2fa_trust: "Trust this device for 90 days",
    login_2fa_submit: "Verify and sign in",
    login_2fa_back: "← Use a different account",
    markets_title_a: "Three ways to",
    markets_title_em: "print",
    markets_title_b: "One account.",
    markets_live: "live markets",
    markets_settled: "Settled in under 4s",
    m1_kind: "Prediction · Sports",
    m1_status: "CLOSES",
    m1_q: "Will BTC close above <span style=\"color:var(--neon)\">$74,000</span> by Friday 11:30 PM?",
    m1_yes: "YES",
    m1_no: "NO",
    m1_liquidity: "Liquidity",
    m1_cta: "Take a side",
    m2_kind: "Crash · Aviator",
    m2_live: "LIVE",
    m2_q1: "One crash. One cashout.",
    m2_q2: "One huge multiplier.",
    m2_in_flight: "In flight",
    m2_players: "players",
    m2_cta: "Take off",
    m3_kind: "Lowest unique bid",
    m3_jackpot: "JACKPOT",
    m3_q_a: "iPhone 17 Pro Max — ",
    m3_q_won: "won for",
    m3_q_b: "by smartest bid.",
    m3_retail: "Retail value",
    m3_cta: "Place your bid",
    trust_countries: "+ countries",
    trust_countries_label: "Already playing",
    trust_payouts: "s payouts",
    trust_payouts_label: "UPI · Crypto · Cards",
    trust_action: "/7 action",
    trust_action_label: "Markets never sleep",
    trust_players: "M+ players",
    trust_players_label: "All-time signups",
    legal_responsible:
      "Play responsibly. 18+. Outcomes are not guaranteed. Stop when it stops being fun.",
    ticker_just_won: "just won",
    ticker_ago: "ago",
    toast_cashed_out: "just cashed out",
  },
  pt: {
    nav_online_now: "online agora",
    hero_eyebrow:
      "Já disponível no seu país — 10+ mercados, saques instantâneos",
    headline_lead: "Transforme",
    headline_accent: "instinto",
    headline_into: "em ganhos.",
    headline_strike: "Dinheiro lento.",
    hero_subcopy:
      "O mercado nunca dorme. Vencedores também não. Preveja o próximo resultado, surfe o crash, dê o lance único mais baixo — e saque antes de todo mundo.",
    stat_paid_today: "Pago até agora",
    stat_players_online: "Jogadores online",
    stat_last_crash: "Último crash",
    stat_active_predictions: "Previsões ativas",
    crash_round: "Rodada #",
    crash_in: "dentro",
    crash_pot: "Bolão",
    crash_cashout_window: "Janela de saque",
    crash_will_10x:
      "Vai 10× hoje? <b style=\"color:var(--text)\">418</b> dizem que sim.",
    login_joining_now: "entrando agora",
    login_tab_login: "Entrar",
    login_tab_signup: "Cadastrar",
    login_title_login: "Entre no mercado.",
    login_sub_login:
      "Jogadores espertos chegam primeiro. Retome de onde parou — previsões, crash e lances únicos estão ao vivo agora.",
    login_title_signup: "Não assista. Vença.",
    login_sub_signup:
      "Junte-se a 1,2M+ jogadores. Jogo grátis no cadastro — sem cartão.",
    login_continue_telegram: "Entrar com Telegram",
    login_or: "OU",
    login_email_phone: "E-mail ou telefone",
    login_password: "Senha",
    login_show: "mostrar",
    login_hide: "ocultar",
    login_play_now: "Jogar agora",
    login_claim: "Resgatar e jogar",
    login_forgot: "Esqueci a senha",
    login_have_account: "Já tem conta? Entrar",
    login_trusted_by: "Confiado por 1,2M+ jogadores",
    login_takes: "Leva ~12 segundos",
    login_securing: "Protegendo sessão…",
    login_2fa_title: "Mais um passo.",
    login_2fa_sub:
      "2FA está ativo nesta conta. Digite o código de 6 dígitos do seu autenticador ou um código de backup de 8 caracteres.",
    login_2fa_code: "Código de verificação",
    login_2fa_trust: "Confiar neste dispositivo por 90 dias",
    login_2fa_submit: "Verificar e entrar",
    login_2fa_back: "← Usar outra conta",
    markets_title_a: "Três formas de",
    markets_title_em: "imprimir",
    markets_title_b: "Uma só conta.",
    markets_live: "mercados ao vivo",
    markets_settled: "Liquidado em menos de 4s",
    m1_kind: "Previsão · Esportes",
    m1_status: "FECHA EM",
    m1_q: "BTC vai fechar acima de <span style=\"color:var(--neon)\">$74.000</span> até sexta às 23:30?",
    m1_yes: "SIM",
    m1_no: "NÃO",
    m1_liquidity: "Liquidez",
    m1_cta: "Escolher lado",
    m2_kind: "Crash · Aviator",
    m2_live: "AO VIVO",
    m2_q1: "Um crash. Um saque.",
    m2_q2: "Um multiplicador enorme.",
    m2_in_flight: "Em voo",
    m2_players: "jogadores",
    m2_cta: "Decolar",
    m3_kind: "Lance único mais baixo",
    m3_jackpot: "JACKPOT",
    m3_q_a: "iPhone 17 Pro Max — ",
    m3_q_won: "ganho por",
    m3_q_b: "com o lance mais esperto.",
    m3_retail: "Valor de varejo",
    m3_cta: "Dar lance",
    trust_countries: "+ países",
    trust_countries_label: "Já jogando",
    trust_payouts: "s saques",
    trust_payouts_label: "PIX · Cripto · Cartão",
    trust_action: "/7 ação",
    trust_action_label: "O mercado não dorme",
    trust_players: "M+ jogadores",
    trust_players_label: "Cadastros totais",
    legal_responsible:
      "Jogue com responsabilidade. 18+. Resultados não garantidos. Pare quando deixar de ser divertido.",
    ticker_just_won: "acabou de ganhar",
    ticker_ago: "atrás",
    toast_cashed_out: "acabou de sacar",
  },
  es: {
    nav_online_now: "en línea ahora",
    hero_eyebrow:
      "Ya disponible en tu país — 10+ mercados, pagos instantáneos",
    headline_lead: "Convierte",
    headline_accent: "instinto",
    headline_into: "en ganancias.",
    headline_strike: "Dinero lento.",
    hero_subcopy:
      "El mercado nunca duerme. Los ganadores tampoco. Predice el próximo resultado, surfea el crash, gana con la puja única más baja — y cobra antes que nadie.",
    stat_paid_today: "Pagado hasta ahora",
    stat_players_online: "Jugadores en línea",
    stat_last_crash: "Último crash",
    stat_active_predictions: "Predicciones activas",
    crash_round: "Ronda #",
    crash_in: "dentro",
    crash_pot: "Bote",
    crash_cashout_window: "Ventana de retiro",
    crash_will_10x:
      "¿Llegará a 10× esta noche? <b style=\"color:var(--text)\">418</b> dicen que sí.",
    login_joining_now: "uniéndose ahora",
    login_tab_login: "Entrar",
    login_tab_signup: "Registrarse",
    login_title_login: "Entra al mercado.",
    login_sub_login:
      "Los jugadores listos llegan primero. Retoma donde lo dejaste — predicciones, crash y pujas únicas en vivo.",
    login_title_signup: "No mires. Gana.",
    login_sub_signup:
      "Únete a 1.2M+ jugadores. Juego gratis al registrarte — sin tarjeta.",
    login_continue_telegram: "Entrar con Telegram",
    login_or: "O",
    login_email_phone: "Correo o teléfono",
    login_password: "Contraseña",
    login_show: "mostrar",
    login_hide: "ocultar",
    login_play_now: "Jugar ya",
    login_claim: "Reclamar y jugar",
    login_forgot: "Olvidé la contraseña",
    login_have_account: "¿Ya tienes cuenta? Entrar",
    login_trusted_by: "1.2M+ jugadores confían",
    login_takes: "Tarda ~12 segundos",
    login_securing: "Asegurando sesión…",
    login_2fa_title: "Un paso más.",
    login_2fa_sub:
      "2FA activado en esta cuenta. Ingresa el código de 6 dígitos de tu app o un código de respaldo de 8 caracteres.",
    login_2fa_code: "Código de verificación",
    login_2fa_trust: "Confiar en este dispositivo por 90 días",
    login_2fa_submit: "Verificar y entrar",
    login_2fa_back: "← Usar otra cuenta",
    markets_title_a: "Tres formas de",
    markets_title_em: "imprimir",
    markets_title_b: "Una sola cuenta.",
    markets_live: "mercados en vivo",
    markets_settled: "Liquidado en menos de 4s",
    m1_kind: "Predicción · Deportes",
    m1_status: "CIERRA",
    m1_q: "¿BTC cierra arriba de <span style=\"color:var(--neon)\">$74,000</span> el viernes a las 11:30 PM?",
    m1_yes: "SÍ",
    m1_no: "NO",
    m1_liquidity: "Liquidez",
    m1_cta: "Elegir lado",
    m2_kind: "Crash · Aviator",
    m2_live: "EN VIVO",
    m2_q1: "Un crash. Un retiro.",
    m2_q2: "Un multiplicador enorme.",
    m2_in_flight: "En vuelo",
    m2_players: "jugadores",
    m2_cta: "Despegar",
    m3_kind: "Puja única más baja",
    m3_jackpot: "JACKPOT",
    m3_q_a: "iPhone 17 Pro Max — ",
    m3_q_won: "ganado por",
    m3_q_b: "con la puja más inteligente.",
    m3_retail: "Precio retail",
    m3_cta: "Hacer puja",
    trust_countries: "+ países",
    trust_countries_label: "Ya jugando",
    trust_payouts: "s pagos",
    trust_payouts_label: "SPEI · Cripto · Tarjeta",
    trust_action: "/7 acción",
    trust_action_label: "El mercado no duerme",
    trust_players: "M+ jugadores",
    trust_players_label: "Registros totales",
    legal_responsible:
      "Juega con responsabilidad. +18. Los resultados no están garantizados. Detente cuando deje de ser divertido.",
    ticker_just_won: "acaba de ganar",
    ticker_ago: "hace",
    toast_cashed_out: "acaba de cobrar",
  },
  fr: {
    nav_online_now: "en ligne",
    hero_eyebrow:
      "Disponible chez vous — 10+ marchés, paiements instantanés",
    headline_lead: "Transformez votre",
    headline_accent: "instinct",
    headline_into: "en gains.",
    headline_strike: "L'argent lent.",
    hero_subcopy:
      "Le marché ne dort jamais. Les gagnants non plus. Prédisez l'issue, surfez le crash, décrochez l'enchère unique la plus basse — et encaissez avant tout le monde.",
    stat_paid_today: "Payé jusqu’à présent",
    stat_players_online: "Joueurs en ligne",
    stat_last_crash: "Dernier crash",
    stat_active_predictions: "Prédictions actives",
    crash_round: "Manche #",
    crash_in: "à bord",
    crash_pot: "Cagnotte",
    crash_cashout_window: "Fenêtre de retrait",
    crash_will_10x:
      "10× ce soir ? <b style=\"color:var(--text)\">418</b> y croient.",
    login_joining_now: "s'inscrivent",
    login_tab_login: "Connexion",
    login_tab_signup: "Inscription",
    login_title_login: "Entrez sur le marché.",
    login_sub_login:
      "Les joueurs malins arrivent en premier. Reprenez où vous en étiez — prédictions, crash et enchères uniques en direct.",
    login_title_signup: "Ne regardez pas. Gagnez.",
    login_sub_signup:
      "Rejoignez 1,2M+ joueurs. Crédit offert à l’inscription — sans CB.",
    login_continue_telegram: "Continuer avec Telegram",
    login_or: "OU",
    login_email_phone: "E-mail ou téléphone",
    login_password: "Mot de passe",
    login_show: "afficher",
    login_hide: "masquer",
    login_play_now: "Jouer",
    login_claim: "Réclamer et jouer",
    login_forgot: "Mot de passe oublié",
    login_have_account: "Déjà un compte ? Connexion",
    login_trusted_by: "1,2M+ joueurs nous font confiance",
    login_takes: "Environ 12 secondes",
    login_securing: "Sécurisation…",
    login_2fa_title: "Une dernière étape.",
    login_2fa_sub:
      "La 2FA est activée sur ce compte. Saisissez le code à 6 chiffres de votre application ou un code de secours à 8 caractères.",
    login_2fa_code: "Code de vérification",
    login_2fa_trust: "Faire confiance à cet appareil 90 jours",
    login_2fa_submit: "Vérifier et se connecter",
    login_2fa_back: "← Utiliser un autre compte",
    markets_title_a: "Trois façons d’",
    markets_title_em: "imprimer",
    markets_title_b: "Un seul compte.",
    markets_live: "marchés en direct",
    markets_settled: "Réglé en moins de 4s",
    m1_kind: "Prédiction · Sports",
    m1_status: "FERME",
    m1_q: "BTC clôturera-t-il au-dessus de <span style=\"color:var(--neon)\">74 000 $</span> vendredi 23:30 ?",
    m1_yes: "OUI",
    m1_no: "NON",
    m1_liquidity: "Liquidité",
    m1_cta: "Choisir un camp",
    m2_kind: "Crash · Aviator",
    m2_live: "EN DIRECT",
    m2_q1: "Un crash. Un retrait.",
    m2_q2: "Un multiplicateur énorme.",
    m2_in_flight: "En vol",
    m2_players: "joueurs",
    m2_cta: "Décoller",
    m3_kind: "Enchère unique la plus basse",
    m3_jackpot: "JACKPOT",
    m3_q_a: "iPhone 17 Pro Max — ",
    m3_q_won: "remporté pour",
    m3_q_b: "par l’enchère la plus maline.",
    m3_retail: "Prix public",
    m3_cta: "Placer une enchère",
    trust_countries: "+ pays",
    trust_countries_label: "Déjà actifs",
    trust_payouts: "s retraits",
    trust_payouts_label: "SEPA · Crypto · CB",
    trust_action: "/7 action",
    trust_action_label: "Le marché ne dort pas",
    trust_players: "M+ joueurs",
    trust_players_label: "Inscriptions totales",
    legal_responsible:
      "Jouez responsable. 18+. Les résultats ne sont pas garantis. Arrêtez quand ce n’est plus un plaisir.",
    ticker_just_won: "vient de gagner",
    ticker_ago: "il y a",
    toast_cashed_out: "vient de retirer",
  },
  ru: {
    nav_online_now: "онлайн",
    hero_eyebrow:
      "Уже доступно в вашей стране — 10+ рынков, мгновенные выплаты",
    headline_lead: "Превращай",
    headline_accent: "интуицию",
    headline_into: "в выигрыш.",
    headline_strike: "Медленные деньги.",
    hero_subcopy:
      "Рынок не спит. Победители — тоже. Угадай исход, поймай краш, выиграй с самой низкой уникальной ставкой — и забери первым.",
    stat_paid_today: "Выплачено до сих пор",
    stat_players_online: "Игроков онлайн",
    stat_last_crash: "Последний краш",
    stat_active_predictions: "Активных прогнозов",
    crash_round: "Раунд #",
    crash_in: "в игре",
    crash_pot: "Банк",
    crash_cashout_window: "Окно вывода",
    crash_will_10x:
      "10× сегодня? <b style=\"color:var(--text)\">418</b> верят.",
    login_joining_now: "заходят сейчас",
    login_tab_login: "Войти",
    login_tab_signup: "Регистрация",
    login_title_login: "Заходи на рынок.",
    login_sub_login:
      "Умные игроки заходят первыми. Продолжай оттуда, где остановился — прогнозы, краш и уникальные ставки в эфире.",
    login_title_signup: "Не смотри. Выигрывай.",
    login_sub_signup:
      "Присоединяйся к 1,2М+ игроков. Фрибет при регистрации — без карты.",
    login_continue_telegram: "Войти через Telegram",
    login_or: "ИЛИ",
    login_email_phone: "E-mail или телефон",
    login_password: "Пароль",
    login_show: "показать",
    login_hide: "скрыть",
    login_play_now: "Играть",
    login_claim: "Забрать и играть",
    login_forgot: "Забыли пароль",
    login_have_account: "Уже есть аккаунт? Войти",
    login_trusted_by: "1,2М+ игроков доверяют",
    login_takes: "Около 12 секунд",
    login_securing: "Защищаем сессию…",
    login_2fa_title: "Ещё один шаг.",
    login_2fa_sub:
      "На аккаунте включена 2FA. Введите 6-значный код из приложения-аутентификатора или 8-символьный резервный код.",
    login_2fa_code: "Код проверки",
    login_2fa_trust: "Доверять этому устройству 90 дней",
    login_2fa_submit: "Подтвердить и войти",
    login_2fa_back: "← Другой аккаунт",
    markets_title_a: "Три способа",
    markets_title_em: "печатать",
    markets_title_b: "Один аккаунт.",
    markets_live: "активных рынков",
    markets_settled: "Расчёт меньше 4с",
    m1_kind: "Прогноз · Спорт",
    m1_status: "ЗАКРЫТИЕ",
    m1_q: "BTC закроется выше <span style=\"color:var(--neon)\">$74 000</span> к пятнице 23:30?",
    m1_yes: "ДА",
    m1_no: "НЕТ",
    m1_liquidity: "Ликвидность",
    m1_cta: "Выбрать сторону",
    m2_kind: "Краш · Aviator",
    m2_live: "ОНЛАЙН",
    m2_q1: "Один краш. Один вывод.",
    m2_q2: "Один огромный множитель.",
    m2_in_flight: "В полёте",
    m2_players: "игроков",
    m2_cta: "Взлетать",
    m3_kind: "Уникальная мин. ставка",
    m3_jackpot: "ДЖЕКПОТ",
    m3_q_a: "iPhone 17 Pro Max — ",
    m3_q_won: "выигран за",
    m3_q_b: "самой умной ставкой.",
    m3_retail: "Розничная цена",
    m3_cta: "Поставить",
    trust_countries: "+ стран",
    trust_countries_label: "Уже играют",
    trust_payouts: "с выплат",
    trust_payouts_label: "СБП · Крипто · Карта",
    trust_action: "/7 экшен",
    trust_action_label: "Рынок не спит",
    trust_players: "М+ игроков",
    trust_players_label: "Всего регистраций",
    legal_responsible:
      "Играй ответственно. 18+. Результаты не гарантированы. Остановись, если это перестало быть весело.",
    ticker_just_won: "только что выиграл",
    ticker_ago: "назад",
    toast_cashed_out: "только что вывел",
  },
  zh: {
    nav_online_now: "在线",
    hero_eyebrow: "已在您所在的地区上线 — 10+ 市场，秒级到账",
    headline_lead: "把",
    headline_accent: "直觉",
    headline_into: "换成奖金。",
    headline_strike: "慢钱时代。",
    hero_subcopy:
      "市场不眠，赢家不眠。预测下一个结果、骑住崩盘、用最低的唯一出价拿下大奖 — 比所有人先一步落袋。",
    stat_paid_today: "迄今已派彩",
    stat_players_online: "在线玩家",
    stat_last_crash: "上次崩盘",
    stat_active_predictions: "进行中的预测",
    crash_round: "第",
    crash_in: "人在场",
    crash_pot: "奖池",
    crash_cashout_window: "兑现窗口",
    crash_will_10x:
      "今晚冲 10×？ <b style=\"color:var(--text)\">418</b> 人押 YES。",
    login_joining_now: "正在加入",
    login_tab_login: "登录",
    login_tab_signup: "注册",
    login_title_login: "走进市场。",
    login_sub_login:
      "聪明玩家先一步。继续你的对局 — 预测、崩盘、唯一最低出价正在进行。",
    login_title_signup: "别旁观，开始赢。",
    login_sub_signup: "加入 120万+ 玩家。注册即送体验金，无需绑卡。",
    login_continue_telegram: "用 Telegram 继续",
    login_or: "或",
    login_email_phone: "邮箱或手机号",
    login_password: "密码",
    login_show: "显示",
    login_hide: "隐藏",
    login_play_now: "立即开始",
    login_claim: "领取并开始",
    login_forgot: "忘记密码",
    login_have_account: "已有账号？登录",
    login_trusted_by: "120万+ 玩家信赖",
    login_takes: "约 12 秒完成",
    login_securing: "安全连接中…",
    login_2fa_title: "还差一步。",
    login_2fa_sub:
      "此账号已启用 2FA。请输入认证器中的 6 位验证码或 8 字符备份码。",
    login_2fa_code: "验证码",
    login_2fa_trust: "信任此设备 90 天",
    login_2fa_submit: "验证并登录",
    login_2fa_back: "← 换一个账号",
    markets_title_a: "三种",
    markets_title_em: "印钞",
    markets_title_b: "同一个账号。",
    markets_live: "场实时市场",
    markets_settled: "4 秒内结算",
    m1_kind: "预测 · 体育",
    m1_status: "截止",
    m1_q: "BTC 周五 23:30 前能否站上 <span style=\"color:var(--neon)\">$74,000</span>？",
    m1_yes: "是",
    m1_no: "否",
    m1_liquidity: "流动性",
    m1_cta: "选边下注",
    m2_kind: "崩盘 · Aviator",
    m2_live: "直播中",
    m2_q1: "一次崩盘，一次兑现。",
    m2_q2: "一个超大倍率。",
    m2_in_flight: "飞行中",
    m2_players: "名玩家",
    m2_cta: "起飞",
    m3_kind: "最低唯一出价",
    m3_jackpot: "大奖",
    m3_q_a: "iPhone 17 Pro Max — ",
    m3_q_won: "被赢走，仅",
    m3_q_b: "一次最聪明的出价。",
    m3_retail: "零售价",
    m3_cta: "出价",
    trust_countries: "+ 国家",
    trust_countries_label: "已经在玩",
    trust_payouts: "秒内出款",
    trust_payouts_label: "银行 · 加密 · 卡",
    trust_action: "小时不停",
    trust_action_label: "市场永不打烊",
    trust_players: "万+ 玩家",
    trust_players_label: "历史注册",
    legal_responsible:
      "理性娱乐。18岁以上。结果不保证。当不再有趣时请停止。",
    ticker_just_won: "刚刚赢得",
    ticker_ago: "前",
    toast_cashed_out: "刚刚兑现",
  },
  id: {
    nav_online_now: "online sekarang",
    hero_eyebrow: "Tersedia di negaramu — 10+ pasar, pencairan instan",
    headline_lead: "Ubah",
    headline_accent: "insting",
    headline_into: "jadi kemenangan.",
    headline_strike: "Uang lambat.",
    hero_subcopy:
      "Pasar tak pernah tidur. Pemenang juga tidak. Tebak hasilnya, naik di crash, sergap bid unik terendah — dan cair sebelum yang lain.",
    stat_paid_today: "Dibayar sampai sekarang",
    stat_players_online: "Pemain online",
    stat_last_crash: "Crash terakhir",
    stat_active_predictions: "Prediksi aktif",
    crash_round: "Ronde #",
    crash_in: "masuk",
    crash_pot: "Pot",
    crash_cashout_window: "Jendela cair",
    crash_will_10x:
      "10× malam ini? <b style=\"color:var(--text)\">418</b> bilang iya.",
    login_joining_now: "sedang gabung",
    login_tab_login: "Masuk",
    login_tab_signup: "Daftar",
    login_title_login: "Masuk ke pasar.",
    login_sub_login:
      "Pemain cerdas duluan. Lanjut dari yang terakhir — prediksi, crash, dan bid unik sedang live.",
    login_title_signup: "Jangan nonton. Menang.",
    login_sub_signup:
      "Gabung 1,2 jt+ pemain. Main gratis saat daftar — tanpa kartu.",
    login_continue_telegram: "Lanjut dengan Telegram",
    login_or: "ATAU",
    login_email_phone: "Email atau telepon",
    login_password: "Kata sandi",
    login_show: "tampil",
    login_hide: "sembunyi",
    login_play_now: "Main sekarang",
    login_claim: "Klaim & main",
    login_forgot: "Lupa kata sandi",
    login_have_account: "Sudah punya akun? Masuk",
    login_trusted_by: "Dipercaya 1,2 jt+ pemain",
    login_takes: "Sekitar 12 detik",
    login_securing: "Mengamankan sesi…",
    login_2fa_title: "Satu langkah lagi.",
    login_2fa_sub:
      "Akun ini punya 2FA. Masukkan kode 6 digit dari authenticator atau kode cadangan 8 karakter.",
    login_2fa_code: "Kode verifikasi",
    login_2fa_trust: "Percayai perangkat ini 90 hari",
    login_2fa_submit: "Verifikasi & masuk",
    login_2fa_back: "← Pakai akun lain",
    markets_title_a: "Tiga cara",
    markets_title_em: "cetak uang",
    markets_title_b: "Satu akun.",
    markets_live: "pasar live",
    markets_settled: "Selesai dalam 4 detik",
    m1_kind: "Prediksi · Olahraga",
    m1_status: "TUTUP",
    m1_q: "BTC tutup di atas <span style=\"color:var(--neon)\">$74.000</span> Jumat 23:30?",
    m1_yes: "YA",
    m1_no: "TIDAK",
    m1_liquidity: "Likuiditas",
    m1_cta: "Pilih sisi",
    m2_kind: "Crash · Aviator",
    m2_live: "LIVE",
    m2_q1: "Satu crash. Satu cairkan.",
    m2_q2: "Satu pengganda besar.",
    m2_in_flight: "Mengudara",
    m2_players: "pemain",
    m2_cta: "Lepas landas",
    m3_kind: "Bid unik terendah",
    m3_jackpot: "JACKPOT",
    m3_q_a: "iPhone 17 Pro Max — ",
    m3_q_won: "dimenangkan seharga",
    m3_q_b: "oleh bid paling cerdas.",
    m3_retail: "Harga retail",
    m3_cta: "Pasang bid",
    trust_countries: "+ negara",
    trust_countries_label: "Sudah main",
    trust_payouts: "dtk cair",
    trust_payouts_label: "QRIS · Kripto · Kartu",
    trust_action: "/7 aksi",
    trust_action_label: "Pasar tak tidur",
    trust_players: "jt+ pemain",
    trust_players_label: "Total daftar",
    legal_responsible:
      "Main bertanggung jawab. 18+. Hasil tidak dijamin. Berhenti jika sudah tidak menyenangkan.",
    ticker_just_won: "baru menang",
    ticker_ago: "lalu",
    toast_cashed_out: "baru mencairkan",
  },
};

/**
 * Per-country winner rosters surfaced in the ticker + toasts.
 * Static for now; swap to a real event-stream feed when one exists
 * — the rendering layer is decoupled from the source.
 */
export const WINNERS_BY_REGION: Record<CountryCode, string[]> = {
  IN: [
    "🇮🇳 arjun.eth",
    "🇮🇳 priya.bid",
    "🇮🇳 rohan_b",
    "🇮🇳 meera.x",
    "🇮🇳 nikhil_27",
    "🇮🇳 tanmay.io",
    "🇮🇳 shreya_k",
    "🇮🇳 ananya.42",
  ],
  BR: [
    "🇧🇷 joao_silva",
    "🇧🇷 beatriz.r",
    "🇧🇷 lucas.aviator",
    "🇧🇷 mateus_88",
    "🇧🇷 camila.bid",
    "🇧🇷 ana.crash",
    "🇧🇷 pedro_h",
    "🇧🇷 gabi.x",
  ],
  FR: [
    "🇫🇷 camille_42",
    "🇫🇷 lucas.fr",
    "🇫🇷 sophie.b",
    "🇫🇷 mathieu_p",
    "🇫🇷 julie.crash",
    "🇫🇷 antoine.k",
    "🇫🇷 chloe.bid",
    "🇫🇷 thomas_88",
  ],
  RU: [
    "🇷🇺 ivan.k",
    "🇷🇺 anastasia",
    "🇷🇺 dmitry_42",
    "🇷🇺 ekaterina.x",
    "🇷🇺 sergey.bid",
    "🇷🇺 alexei_99",
    "🇷🇺 natalia.crash",
    "🇷🇺 maxim_b",
  ],
  PH: [
    "🇵🇭 mark.ph",
    "🇵🇭 angel_42",
    "🇵🇭 jovito.bid",
    "🇵🇭 nina.x",
    "🇵🇭 paolo_88",
    "🇵🇭 trisha.k",
    "🇵🇭 carlo.crash",
    "🇵🇭 mika.aviator",
  ],
  CN: [
    "🇨🇳 wei_lin",
    "🇨🇳 mei.x",
    "🇨🇳 hao_42",
    "🇨🇳 jing.bid",
    "🇨🇳 yu_chen",
    "🇨🇳 zhao.k",
    "🇨🇳 li.crash",
    "🇨🇳 xiaolong",
  ],
  MX: [
    "🇲🇽 diego_mx",
    "🇲🇽 sofia.b",
    "🇲🇽 mateo.42",
    "🇲🇽 valeria.x",
    "🇲🇽 santiago.k",
    "🇲🇽 regina.bid",
    "🇲🇽 emiliano_88",
    "🇲🇽 luna.crash",
  ],
  ID: [
    "🇮🇩 budi.id",
    "🇮🇩 sari_42",
    "🇮🇩 ahmad.x",
    "🇮🇩 rina.bid",
    "🇮🇩 dewi.k",
    "🇮🇩 hendra_88",
    "🇮🇩 putri.crash",
    "🇮🇩 rizky.aviator",
  ],
  NG: [
    "🇳🇬 chidi_ng",
    "🇳🇬 ade.bid",
    "🇳🇬 ifeoma.x",
    "🇳🇬 emeka_42",
    "🇳🇬 funke.k",
    "🇳🇬 tunde.crash",
    "🇳🇬 yemi_88",
    "🇳🇬 ngozi.aviator",
  ],
  AE: [
    "🇦🇪 ahmed.uae",
    "🇦🇪 fatima.x",
    "🇦🇪 omar_42",
    "🇦🇪 layla.bid",
    "🇦🇪 khalid.k",
    "🇦🇪 mariam.crash",
    "🇦🇪 saif_88",
    "🇦🇪 hessa.aviator",
  ],
  US: [
    "🇺🇸 jake_t",
    "🇺🇸 ashley.x",
    "🇺🇸 marcus.42",
    "🇺🇸 chloe.k",
    "🇺🇸 ethan_88",
    "🇺🇸 mia.bid",
    "🇺🇸 ryan.crash",
    "🇺🇸 sophia.aviator",
  ],
};

/**
 * Build a globally-mixed winners pool with the user's home region
 * over-represented. Communicates "everyone's playing" without
 * pretending only Indian players exist on an Indian visitor's screen.
 */
export function buildMixedWinners(homeRegion: CountryCode): string[] {
  const home = WINNERS_BY_REGION[homeRegion] ?? WINNERS_BY_REGION.IN;
  const others = (
    Object.entries(WINNERS_BY_REGION) as Array<[CountryCode, string[]]>
  )
    .filter(([k]) => k !== homeRegion)
    .flatMap(([, arr]) => arr.slice(0, 2));
  return [...home, ...others].slice(0, 20);
}

/**
 * Look up a translation key with English fallback. The `lang`
 * argument comes from `LOCALES[country].lang`.
 */
export function getString(key: StringKey, lang: LanguageCode): string {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? "";
}

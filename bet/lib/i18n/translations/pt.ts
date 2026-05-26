import type { Dictionary } from "./en";

/**
 * Portuguese (pt-BR baseline). Strings missing from this dictionary
 * fall back to the English copy in `./en.ts` via the deep-fallback
 * walker in `../index.ts::t`.
 *
 * Translation notes (PR-BET-I18N):
 *   - Initial pass is machine-translated + lightly hand-edited for
 *     fintech tone. The product team should review before going live.
 *   - Currency-free copy where possible; "moedas" reads cleanly in
 *     pt-BR for "demo coins".
 *   - "Cash out" intentionally NOT translated — the term is well-
 *     understood in Brazilian Portuguese gambling/prediction-market
 *     vernacular (loanword from English).
 */
const pt: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Exchange",
    tagline:
      "Negocie SIM/NÃO em eventos do mundo real com suas moedas Kalki Bet — a mesma carteira que alimenta os leilões e o Aviator.",
    description:
      "Mercados de previsão, leilões ao vivo e crash-game — uma carteira, três produtos, tudo movido a moedas demo.",
  },
  nav: {
    home: "Início",
    markets: "Mercados",
    portfolio: "Portfólio",
    wallet: "Carteira",
    profile: "Perfil",
    leaderboard: "Ranking",
    notifications: "Notificações",
    signIn: "Entrar",
    signOut: "Sair",
    register: "Cadastrar",
  },
  landing: {
    heroKicker: "Preveja. Negocie. Ganhe.",
    heroTitle: "Eventos reais. Opiniões reais. Apostas reais.",
    heroDescription:
      "Escolha um lado, defina seu preço, veja o mercado se mover. Faça cash-out a qualquer momento antes do evento ser resolvido.",
    ctaPrimary: "Ver mercados",
    ctaSecondary: "Como funciona",
    statsMarkets: "Mercados ativos",
    statsUsers: "Jogadores",
    statsTrades: "Negociações realizadas",
    trendingHeader: "Mercados em alta",
    leaderboardHeader: "Top traders",
  },
  wallet: {
    title: "Sua carteira",
    balance: "Saldo de moedas",
    buyCoins: "Comprar moedas",
    withdraw: "Sacar",
    minWithdraw: "Mín. {amount} moedas",
    payWithCrypto:
      "Pague com cripto — BTC, ETH, USDT, USDC e mais 200. Suas moedas chegam automaticamente assim que o pagamento for confirmado on-chain.",
    askAdmin: "Fale com um administrador no Secure Kalki Chat para pagamentos",
    downloadChatApp: "Baixe o Secured Chat App agora",
    unifiedPromise:
      "Um saldo único entre Mercados, Leilões e Aviator. Cada recarga aparece no seu histórico.",
  },
  market: {
    yes: "SIM",
    no: "NÃO",
    volume: "Volume",
    ends: "Termina",
    resolved: "Resolvido",
    cancelled: "Cancelado",
    place_bet: "Apostar",
    cash_out: "Cash out",
    order_book: "Livro de ofertas",
    trades: "Negociações",
    comments: "Comentários",
  },
  auth: {
    email: "E-mail",
    username: "Nome de usuário",
    password: "Senha",
    signInTitle: "Entrar na Kalki Exchange",
    registerTitle: "Crie sua conta Kalki",
    forgotPassword: "Esqueceu a senha?",
    needAccount: "Não tem uma conta?",
    haveAccount: "Já tem uma conta?",
    googleSignIn: "Entrar com Google",
    errors: {
      invalidCredentials: "E-mail ou senha incorretos.",
      emailTaken: "Esse e-mail já está cadastrado.",
      usernameTaken: "Esse nome de usuário já está em uso.",
      weakPassword: "Use 8+ caracteres com letras e números.",
    },
  },
  switcher: {
    label: "Idioma",
    chooseLanguage: "Escolha seu idioma",
  },
  banner: {
    geoSuggest: "Ver este site em {language}?",
    geoSuggestYes: "Sim, mudar",
    geoSuggestNo: "Continuar em inglês",
  },
  errors: {
    notFound: "Página não encontrada",
    notFoundDescription: "A página que você procura não existe ou foi movida.",
    backHome: "Voltar ao início",
  },
};

export default pt;

/**
 * English translations (PR-BET-I18N). The canonical key set — every
 * other locale dictionary mirrors this structure. Missing keys in
 * pt/es/fr fall back to whatever string lives here at the same key
 * path (see `lib/i18n/index.ts::t`).
 *
 * Keep keys hierarchical (`nav.markets`, not `navMarkets`) so the
 * translation files stay readable as the surface grows. Two-level
 * depth is the practical limit — deeper than that and the path
 * strings become noise.
 */

// Recursive dictionary shape — string leaves, nested objects allowed.
// Using `interface` (not `as const`) so other locales can carry their
// own copy of each leaf without TypeScript demanding identical
// literals. The Dictionary type is exported for use by partial
// translations in pt.ts / es.ts / fr.ts.
export interface Dictionary {
  [key: string]: string | Dictionary;
}

const en: Dictionary = {
  meta: {
    siteName: "Kalki Exchange",
    tagline:
      "Trade YES/NO on real-world events with your Kalki Bet coins — the same wallet that powers auctions and Aviator.",
    description:
      "Prediction markets, live auctions, and crash-game gameplay — one wallet, three products, all powered by demo coins.",
  },

  nav: {
    home: "Home",
    markets: "Markets",
    portfolio: "Portfolio",
    wallet: "Wallet",
    profile: "Profile",
    leaderboard: "Leaderboard",
    notifications: "Notifications",
    signIn: "Sign in",
    signOut: "Sign out",
    register: "Sign up",
  },

  landing: {
    heroKicker: "Predict. Trade. Win.",
    heroTitle: "Real-world events. Real opinions. Real stakes.",
    heroDescription:
      "Pick a side, set your price, watch the market move. Cash out anytime before the event resolves.",
    ctaPrimary: "Browse markets",
    ctaSecondary: "How it works",
    statsMarkets: "Active markets",
    statsUsers: "Players",
    statsTrades: "Trades placed",
    trendingHeader: "Trending markets",
    leaderboardHeader: "Top traders",
  },

  wallet: {
    title: "Your wallet",
    balance: "Coin balance",
    buyCoins: "Buy coins",
    withdraw: "Withdraw",
    minWithdraw: "Min {amount} coins",
    payWithCrypto:
      "Pay with crypto — BTC, ETH, USDT, USDC and 200+ more. Your coins land in your wallet automatically once the payment confirms on-chain.",
    askAdmin: "Ask an Admin on Secure Kalki Chat for payments",
    downloadChatApp: "Download Secured Chat App now",
    unifiedPromise:
      "One balance across Markets, Auctions and Aviator. Every top-up is logged in your transaction history.",
  },

  market: {
    yes: "YES",
    no: "NO",
    volume: "Volume",
    ends: "Ends",
    resolved: "Resolved",
    cancelled: "Cancelled",
    place_bet: "Place bet",
    cash_out: "Cash out",
    order_book: "Order book",
    trades: "Trades",
    comments: "Comments",
  },

  auth: {
    email: "Email",
    username: "Username",
    password: "Password",
    signInTitle: "Sign in to Kalki Exchange",
    registerTitle: "Create your Kalki account",
    forgotPassword: "Forgot password?",
    needAccount: "Don't have an account?",
    haveAccount: "Already have an account?",
    googleSignIn: "Sign in with Google",
    errors: {
      invalidCredentials: "Email or password is incorrect.",
      emailTaken: "That email is already registered.",
      usernameTaken: "That username is taken.",
      weakPassword: "Use 8+ characters with a mix of letters and numbers.",
    },
  },

  switcher: {
    label: "Language",
    chooseLanguage: "Choose your language",
  },

  banner: {
    geoSuggest: "View this site in {language}?",
    geoSuggestYes: "Yes, switch",
    geoSuggestNo: "Stay in English",
  },

  errors: {
    notFound: "Page not found",
    notFoundDescription: "The page you're looking for doesn't exist or has moved.",
    backHome: "Back to home",
  },
};

export default en;

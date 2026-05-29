/**
 * English translations — canonical dictionary (PR-BET-I18N).
 *
 * The structure here is the contract every other locale dictionary
 * follows. Missing keys in pt/es/fr fall back to whatever string
 * lives at the same key path here (deep-walker in
 * `../index.ts::t`), so a half-translated dictionary never blanks
 * the UI — it just shows the English value until the translator
 * fills it in.
 *
 * Keep keys hierarchical (`auth.errors.emailTaken`, not
 * `authErrorsEmailTaken`). Two-level depth is the practical limit;
 * deeper than that and the dot-path strings become noise at call
 * sites.
 *
 * Interpolation: use `{name}` tokens; pass values as the third arg
 * to `t()`. No ICU format specifiers — call sites format
 * numbers/dates with `Intl.*` ahead of time.
 */

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
    // ─── Per-page SEO (title + description) ────────────────────
    // Marketing-tone copy distinct from the on-page H1s. These flow
    // into <title>, <meta description>, OG and Twitter cards.
    homeTitle: "Predict, trade and win on real-world events",
    homeDescription:
      "Trade YES/NO prediction markets on news, politics, sports and crypto. Free starter coins; cash out anytime before the event resolves.",
    marketsTitle: "Prediction markets — trade real-world events",
    marketsDescription:
      "Browse open prediction markets, watch prices move in real time, and trade with your Kalki Bet coins.",
    eventsTitle: "Events — multi-outcome prediction markets",
    eventsDescription:
      "Browse grouped events ranked by live odds. Each candidate is its own YES/NO market — compare the field and trade the outcome you believe in.",
    walletTitle: "Your wallet · Kalki Bet coins",
    walletDescription:
      "Top up, withdraw, and track every coin movement. One balance across Markets, Auctions and Aviator.",
    profileTitle: "Your profile",
    profileDescription:
      "Manage your account, referrals, achievements and verification status.",
    portfolioTitle: "Your portfolio",
    portfolioDescription:
      "Mark-to-market valuation of your open YES/NO positions across every prediction market.",
    watchlistTitle: "Watchlist",
    watchlistDescription:
      "Your starred markets — quick access to the prediction markets you're tracking.",
    notificationsTitle: "Notifications",
    notificationsDescription:
      "Trade fills, market resolutions, mentions and rewards — your inbox for everything that happened while you were away.",
    achievementsTitle: "Achievements — trader badges",
    achievementsDescription:
      "Unlock badges by trading, inviting friends and hitting milestones. Earn XP and bonus coins.",
    kycTitle: "Identity verification",
    kycDescription:
      "Submit identity documents to unlock higher withdrawal limits. Encrypted at rest and reviewed by a compliance specialist.",
    loginTitle: "Sign in to Kalki Exchange",
    loginDescription:
      "Sign in to trade prediction markets, manage your wallet and track your portfolio.",
    registerTitle: "Create your Kalki account",
    registerDescription:
      "Sign up in seconds and receive 10,000 starter coins. Trade prediction markets on news, sports and crypto.",
    forgotTitle: "Reset your password",
    forgotDescription:
      "Forgot your password? Enter your email to receive a reset link.",
    resetTitle: "Choose a new password",
    resetDescription:
      "Set a new password for your Kalki Exchange account.",
    verifyTitle: "Verify your email",
    verifyDescription:
      "Confirm your email address to unlock withdrawals and account features.",
    withdrawTitle: "Withdraw coins",
    withdrawDescription:
      "Cash out your Kalki Bet coins to UPI or bank. Each withdrawal is reviewed before payout.",
  },

  nav: {
    home: "Home",
    markets: "Markets",
    events: "Events",
    portfolio: "Portfolio",
    wallet: "Wallet",
    profile: "Profile",
    watchlist: "Watchlist",
    achievements: "Achievements",
    notifications: "Notifications",
    admin: "Admin",
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
  },

  forms: {
    required: "Required",
    optional: "Optional",
    save: "Save",
    cancel: "Cancel",
    submit: "Submit",
    edit: "Edit",
    delete: "Delete",
    back: "← Back",
    loading: "Loading…",
    sending: "Sending…",
  },

  loading: {
    generic: "Loading…",
    markets: "Loading markets…",
    wallet: "Loading wallet…",
    portfolio: "Loading portfolio…",
    profile: "Loading profile…",
  },

  validation: {
    required: "Required field.",
    emailInvalid: "Enter a valid email address.",
    passwordMinLength: "Password must be at least 8 characters.",
    passwordsDontMatch: "Passwords don't match.",
    invalidInput: "Please check the form for errors.",
  },

  toast: {
    saved: "Saved.",
    copied: "Copied.",
    error: "Something went wrong.",
    submitted: "Submitted for review.",
    coins: "coins",
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
    generic: "Something went wrong.",
    network: "Network error. Try again.",
    unauthorized: "Please sign in.",
  },

  auth: {
    // ─── Common form labels ────────────────────────────────────
    emailLabel: "Email",
    passwordLabel: "Password",
    usernameLabel: "Username",
    usernamePlaceholder: "3–20 chars, letters/digits/underscore",
    referralCodeLabel: "Referral code (optional)",
    referralCodePlaceholder: "ABC123",
    forgotEmailPlaceholder: "you@example.com",
    backButton: "← Back",
    backToSignIn: "← Back to sign in",

    // ─── Sign in (login) ───────────────────────────────────────
    signInTitle: "Sign in to Kalki Exchange",
    welcomeHeading: "Welcome back",
    welcomeSubtext: "Sign in to trade prediction markets with your Kalki Bet coins.",
    signInButton: "Sign in",
    signingInButton: "Signing in…",
    googleSignIn: "Continue with Google",
    forgotPasswordLink: "Forgot password?",
    needAccount: "Don't have an account?",
    registerLink: "Create one",
    invalidCredentials: "Invalid email or password.",

    // ─── Register ──────────────────────────────────────────────
    registerTitle: "Create your Kalki account",
    createAccountHeading: "Create your account",
    createSubtext:
      "We'll credit you 10,000 starter coins instantly — they work across markets, auctions and Aviator.",
    createAccountButton: "Create account",
    creatingAccountButton: "Creating account…",
    alreadyRegistered: "Already registered?",
    signInLink: "Sign in",
    signUpSuccess: "Welcome! 10,000 starter coins are in your wallet.",

    // ─── Forgot password ───────────────────────────────────────
    forgotPasswordHeading: "Forgot password",
    forgotPasswordSubtext:
      "Enter your email; we'll send a reset link if there's a matching account.",
    forgotSendButton: "Send reset link",
    forgotSendingButton: "Sending…",
    forgotSuccess:
      "✅ If {email} is registered, you'll receive a reset link shortly. The link expires in 1 hour.",
    forgotDevNote: "Dev: check the Next.js server console for the link.",
    couldntSendLink: "Couldn't send link.",

    // ─── Reset password ────────────────────────────────────────
    chooseNewPasswordHeading: "Choose a new password",
    newPasswordLabel: "New password",
    confirmPasswordLabel: "Confirm password",
    updatePasswordButton: "Update password",
    updatingPasswordButton: "Updating…",
    invalidOrExpiredLink: "This link is invalid or has expired.",
    couldntResetPassword: "Could not reset password.",
    passwordUpdatedSignedIn: "Password updated. You're now signed in.",
    passwordUpdatedSignIn: "Password updated. Please sign in.",
    missingResetToken: "Missing reset token.",
    requestNewLink: "Request a new link →",

    // ─── Email verification ────────────────────────────────────
    emailVerificationHeading: "Email verification",
    verifyingLink: "Verifying your link…",
    verifySuccess: "✅ Your email is verified. Welcome aboard.",
    continueProfileButton: "Continue to profile",
    verifyInvalidLink: "This link is invalid or has expired.",
    requestNewVerifyLink: "Request a new one →",

    // ─── Sign out ──────────────────────────────────────────────
    signOut: "Sign out",
    signOutAll:
      "Signs you out of all three Kalki games and clears your session on this device.",
    signOutButton: "Sign out of all games",
    signingOutButton: "Signing out…",
    signingYouIn: "Signing you in…",
    bridgingSession:
      "Bridging your Kalki Bet session — this only happens once per launch.",

    // ─── Error messages ────────────────────────────────────────
    emailTaken: "That email is already registered.",
    usernameTaken: "That username is taken.",
    rateLimited: "Too many attempts — please wait a minute.",
    tooManyRequests: "Too many requests — wait a bit.",
    invalidInput: "Please check the form for errors.",
    createError: "Could not create account.",
    weakPassword: "Use 8+ characters with a mix of letters and numbers.",
  },

  market: {
    yes: "YES",
    no: "NO",
    volume: "Volume",
    liquidity: "Liquidity",
    midPrice: "Mid price",
    ends: "Ends",
    endsDate: "Ends {date}",
    created: "Created",
    resolved: "Resolved",
    resolvedOutcome: "Resolved {outcome}",
    cancelled: "Cancelled",
    featured: "Featured",
    placeBet: "Place bet",
    cashOut: "Cash out",
    orderBook: "Order book",
    trades: "Trades",
    recentTrades: "Recent trades",
    noTrades: "No trades yet.",
    totalTrades: "{count} total",
    comments: "Comments",
    commentsCount: "{count} comments",
    discussion: "Discussion",
    marketStats: "Market stats",
    priceHistory: "Price history",
    resolutionSource: "Resolution source:",
    resolution: "Resolution:",
    // ─── List page ─────────────────────────────────────────────
    heading: "Markets",
    searchPlaceholder: "Search markets…",
    sortTrending: "Trending",
    sortVolume: "Volume",
    sortEnding: "Ending soon",
    sortNewest: "Newest",
    filterOpen: "Open",
    filterResolved: "Resolved",
    filterAll: "All",
    applyButton: "Apply",
    categoryAll: "All",
    categoryPolitics: "Politics",
    categorySports: "Sports",
    categoryCrypto: "Crypto",
    categoryTech: "Tech",
    categoryEnt: "Ent.",
    noMatches: "No markets match these filters.",
    marketCount: "{count} {status} market{s}",
    notFound: "Market not found",
    shares: "shares",
    vol: "Vol",
    liq: "liq.",
    statusOpen: "open",
    statusResolved: "resolved",
    statusClosed: "closed",
    statusCancelled: "cancelled",
    // ─── List page (Markets v2) ────────────────────────────────
    crumbTrade: "Trade",
    titleLead: "Trade",
    titleEm: "real-world events",
    subtitle:
      "Buy YES or NO on what happens next. Prices move with the crowd, settle when the truth lands.",
    liveMarkets: "{count} live markets",
    openInterest: "{coins} coins traded",
    settleFast: "Settles in seconds",
    statOpen: "Open",
    statVolume: "Volume",
    statNewToday: "New today",
    statResolved: "Resolved",
    paysIfYes: "Pays if YES",
    paysIfNo: "Pays if NO",
    payoutLine: "1 coin / share · {mult}× return",
    pctYes: "{pct}% YES",
    pctNo: "{pct}% NO",
    openMarket: "Open market",
    statusFilterLabel: "Status",
    sortLabel: "Sort",
    topMarkets: "Top markets",
    openCountLabel: "{count} open",
    sortedByLive: "Sorted by {sort} · Live",
    showingCount: "Showing {shown} of {total} markets",
    onlyFeatured: "All open markets are featured above.",
    footerBrand: "kalki.bet · markets",
    footerCompliance: "18+ · play responsibly",
    // ─── Trade panel ───────────────────────────────────────────
    buy: "BUY",
    sell: "SELL",
    coinsToSpend: "Coins to spend",
    sharesToSell: "Shares to sell",
    youHold: "you hold {amount}",
    youHoldOnly: "You hold only {amount} {outcome}",
    tradingClosed: "Trading closed",
    signInToTrade: "Sign in to trade",
    placing: "Placing…",
    buyOutcome: "Buy {outcome}",
    sellOutcome: "Sell {outcome}",
    youReceive: "You receive",
    avgPrice: "Avg price",
    priceAfter: "Price after",
    maxPayout: "Max payout",
    maxPayoutHint: "If resolved in your favor",
    realisedPL: "Realised P/L (this trade)",
    enterCoins: "Enter coins",
    enterShares: "Enter shares",
    noSharesToSell: "No shares to sell",
    yourPosition: "Your position",
    cost: "cost",
    routing: "Routing",
    routingAMMOnly: "AMM only",
    routingMixed: "Mixed · {bookLegs} book leg{s}{amm}",
    routingMixedAMM: " + AMM",
    book: "Book",
    amm: "AMM",
    boughtToast: "Bought {shares} {outcome} for {coins} coins",
    soldToast: "Sold {shares} {outcome} for {coins} coins",
    // Trade error codes (mapped from prettyTradeError)
    errInsufficientCoins: "Not enough coins. Top up your wallet to keep trading.",
    errInsufficientShares: "You don't have enough shares to sell that much.",
    errMarketNotOpen: "This market is no longer accepting trades.",
    errMarketNotFound: "Market vanished.",
    errRateLimited: "Slow down — wait a moment before trading again.",
    errQuoteFailed: "Trade size too large for current liquidity.",
    errUnauthorized: "Please sign in.",
    errTradeGeneric: "Could not place trade.",
    // ─── Open orders panel ─────────────────────────────────────
    yourOrders: "Your orders",
    noOrdersPlaced: "No orders placed yet.",
    filledLabel: "{filled} filled / {remaining} left",
    sharesAbbrev: "sh",
    cancel: "Cancel",
    cancelling: "…",
    orderCancelledToast: "Order cancelled.",
    couldNotCancelToast: "Could not cancel.",
    orderUpdatedToast: "Order updated.",
    editAtPrice: "edit at price ×",
    newPriceLabel: "New price",
    newSizeLabel: "New size (max {max})",
    repositionNote:
      "Reposition only — size can shrink but not grow. To increase, cancel this order and place a new one.",
    saveAriaLabel: "Save",
    cancelEditAriaLabel: "Cancel edit",
    editAriaLabel: "Edit",
    // Replace-order error codes
    errReplaceInsufficientCoins: "Not enough coins for the new size at this price.",
    errReplaceInsufficientShares: "Not enough free shares for the new size.",
    errSizeIncreaseNew: "Can't grow the order — cancel and place a new one.",
    errOrderClosed: "Order already filled or cancelled.",
    errMarketEnded: "Market no longer accepting changes.",
    errInvalidPriceSize: "Check the new price (0.01–0.99) and size.",
    errReplaceGeneric: "Couldn't update the order.",
  },

  // ─── Grouped markets ("events") ──────────────────────────────
  // An event bundles related YES/NO markets (one per candidate) into a
  // single ranked list. Each row still trades as its own market.
  group: {
    heading: "Events",
    eventCount: "{count} event{s}",
    candidates: "candidates",
    candidateCount: "{count} candidate{s}",
    chance: "Chance",
    buy: "Buy",
    vol: "Vol",
    showAll: "Show all {count}",
    showLess: "Show less",
    empty: "No candidates in this event yet.",
    notFound: "Event not found",
  },

  wallet: {
    heading: "Wallet",
    title: "Your wallet",
    subtext: "One balance across markets, auctions and Aviator.",
    currentBalance: "Current balance",
    balance: "Coin balance",
    coins: "coins",
    // Estimated local-currency value of the balance, anchored to the
    // 1000-coin pack price for the user's region (what they paid per coin).
    estValue: "≈ {value}",
    unified: "Unified",
    unifiedNote: "Same wallet across all Kalki Bet games.",
    // ── Wallet v2 redesign strings ──
    crumbAccount: "Account",
    emailVerified: "Email verified",
    verifyEmail: "Verify email",
    statusGames: "Markets · Auctions · Aviator",
    statusMethods: "UPI · Crypto · USDT",
    stepTopup: "02 · Top up",
    stepCashout: "03 · Cash out",
    stepLedger: "04 · Ledger",
    available: "Available",
    balanceLabel: "Balance",
    stat7dNet: "7d Net",
    stat7dVolume: "7d Volume",
    txUnit: "tx",
    complianceTitle: "Play responsibly",
    complianceBody:
      "Markets are uncertain. Stop when it stops being fun. Take a break whenever you need one.",
    footerBrand: "kalki · wallet",
    needHelp: "Need help?",
    chatTitle: "Secure Kalki Chat",
    chatBody:
      "Talk to an admin for top-ups, payouts, KYC and disputes. End-to-end encrypted, never on third-party platforms.",
    chatButton: "Open / Download Chat",
    chatNotConfigured: "The Secure Chat app link hasn't been configured yet.",
    hide: "Hide",
    show: "Show",
    toggleCoins: "Coins",
    toggleHidden: "Hidden",
    last24h: "24h",
    customAmount: "Custom amount",
    choosePack: "Choose a pack",
    coinsToBuy: "Coins to buy",
    youPay: "You pay",
    minTopup: "Minimum {amount} coins",
    pillTopup: "Top-up",
    pillBonus: "Bonus",
    pillReferral: "Referral",
    pillReward: "Reward",
    pillDaily: "Daily",
    pillGrant: "Grant",
    pillPredict: "Predict",
    payoutMethods: "Payout methods",
    unifiedPromise:
      "One balance across Markets, Auctions and Aviator. Every top-up is logged in your transaction history.",
    securityNote:
      "One balance across Markets, Auctions and Aviator. Every top-up is logged in your transaction history.",
    buyCoins: "Buy coins",
    withdraw: "Withdraw",
    minWithdraw: "min {amount} coins",
    withdrawSubtext:
      "Cash out coins to your UPI or bank account. Each request goes to an admin for review before payout.",
    requestWithdrawal: "Request withdrawal",
    verifyEmailNote:
      "Verify your email before requesting a withdrawal. Open the profile page and click \"Send link\".",
    inReview: "In review",
    recentActivity: "Recent activity",
    fullLedger: "Full ledger →",
    noActivity: "No activity yet.",
    tapToTopup: "Wallet — tap to top up",
    // ─── Buy coins flow ────────────────────────────────────────
    payWithCrypto:
      "Pay with crypto — BTC, ETH, USDT, USDC and 200+ more. Your coins land in your wallet automatically once the payment confirms on-chain.",
    askAdmin: "Ask an Admin on Secure Kalki Chat for payments",
    downloadChatApp: "Download Secured Chat App now",
    chatAppMessage: "Ask an Admin on Secure Kalki Chat for payments",
    chatAppDownload:
      "For coin top-ups, message an Admin on Secured Kalki Chat. Download Secured Chat App now ↓",
    chatAppNoUrl:
      "For coin top-ups, message an Admin on Secured Kalki Chat. (Download link not configured — ask the super admin to set it in /admin/settings.)",
    paymentWidgetError: "Payment widget didn't load. Refresh and try again.",
    alreadyCredited: "Already credited.",
    creditsBalance: "+{coins} coins · balance {balance}",
    alreadyCreditedPack: "Already credited — try a different pack.",
    unknownPack: "That pack isn't available.",
    slowDown: "Slow down — wait a minute before buying again.",
    noPaymentConfig: "Payments aren't configured. Ask an admin.",
    orderCreateFailed: "Couldn't create a payment order. Try again.",
    badSignature:
      "Payment verification failed. Contact support if money was charged.",
    instantDisabled: "Instant top-up is disabled. Use the payment flow.",
    unauthorized: "Please sign in.",
    topUpFailed: "Top-up failed. Try again.",
  },

  withdraw: {
    heading: "Withdraw coins",
    subtext:
      "Minimum withdrawal {amount} coins. Admin review is typically same-day.",
    estValue:
      "Your {coins} coins are worth about {value} at your region's coin price.",
    emailThresholdNote:
      "Withdrawals over {amount} coins require a verified email.",
    submitRequest: "Submit request",
    available: "available {amount} coins",
    verifyEmail:
      "Verify your email first. Open the profile page and tap \"Send link\" — clicking the link in your inbox unblocks withdrawals.",
    coinLocked:
      "Coins are locked the moment you submit — they leave your usable balance so you can't spend them on a market while admin review is pending. Cancel a pending request any time to release the lock.",
    yourWithdrawals: "Your withdrawals",
    noWithdrawals: "No withdrawals yet.",
    backToWallet: "← Back to wallet",
    // ─── Admin actions (component) ─────────────────────────────
    notePlaceholder: "Note (visible to the user, optional)",
    approve: "Approve",
    reject: "Reject",
    payoutRefId: "Payout reference id (required)",
    markPaid: "Mark paid",
    approvedNote: "Approved — process the payout externally, then mark paid.",
    rejectedNote: "Rejected — coins refunded.",
    paidNote: "Marked paid.",
    invalidState: "Already decided — refresh the page.",
    missingReference: "Paste the payout reference id first.",
    notFound: "That withdrawal vanished.",
    actionFailed: "Action failed.",
  },

  profile: {
    heading: "Profile",
    wallet: "Wallet",
    buyCoinButton: "Buy coins",
    referral: "Referral",
    referralSubtext:
      "Share your code — when someone signs up with it you both get bonus coins.",
    achievements: "Achievements",
    walletCoins: "Kalki Bet coins",
    levelBadge: "Lvl {level}",
    adminBadge: "Admin",
    streakBadge: "{days}d streak",
    xpLabel: "{xp} XP",
    xpToNext: "{xp} XP to lvl {level}",
  },

  portfolio: {
    heading: "Portfolio",
    subtext: "Mark-to-market valuation of your open positions.",
    wallet: "Wallet",
    atCost: "At cost",
    valueNow: "Value now",
    pl: "P/L",
    openPositions: "Open positions",
    noPositions: "No positions yet. Browse markets →",
    recentTrades: "Recent trades",
    noTrades: "No trades yet.",
    // ─── Portfolio v2 ──────────────────────────────────────────
    titleLead: "Your",
    titleEm: "portfolio",
    subtitle: "Live positions, P&L and allocation — marked to market off live prices.",
    totalValue: "Total value",
    pnl24: "24h P&L",
    allTime: "All-time",
    winRate: "Win rate",
    valueLive: "Portfolio value · live",
    deltaH24: "24H",
    deltaAllTime: "ALL-TIME",
    cash: "CASH",
    inPositions: "IN POSITIONS",
    snapshot: "Snapshot",
    acrossCats: "across {count} categories",
    avgTicket: "Avg ticket",
    bestWin: "Best win",
    worstLoss: "Worst loss",
    realized: "realized",
    realizedPnl: "Realized P&L",
    allTimeLc: "all-time",
    marketsTouched: "Markets touched",
    last30d: "last 30 days",
    goToMarkets: "Go to markets",
    eyebrowAllocation: "02 · Allocation",
    allocationTitle: "How your {amount} coins are exposed",
    findMarkets: "Find markets",
    noExposure: "No open exposure yet — your positions will show here.",
    eyebrowPositions: "03 · Positions",
    resolvedPositions: "Resolved positions",
    tabOpen: "Open",
    tabResolved: "Resolved",
    noResolved: "No resolved positions yet.",
    colMarket: "Market",
    colStake: "Stake",
    colAvg: "Avg",
    colMark: "Mark",
    colValue: "Value",
    colPnl: "P&L",
    view: "View",
    close: "Close",
    showingPositions: "Showing {shown} of {total}",
    eyebrowStreak: "04 · Streak",
    dailyActivity: "Daily activity",
    daysInARow: "days in a row",
    daysAgo14: "14 days ago",
    today: "today",
    eyebrowActivity: "05 · Activity",
    eyebrowBadges: "06 · Badges",
    badgesUnlocked: "{n} of {total} unlocked",
    viewAll: "View all",
    noBadges: "No badges yet.",
    footerBrand: "kalki.bet · portfolio",
    streakDays: "{count} DAY STREAK",
    openCount: "{count} OPEN",
    allTimeStrip: "{amount} all-time",
  },

  watchlist: {
    heading: "Watchlist",
    emptyState:
      "You haven't starred any markets yet. Tap the {icon} on a market to add it.",
    watching: "Watching",
    watch: "Watch",
    couldntUpdate: "Couldn't update watchlist.",
    // ─── Watchlist v2 ──────────────────────────────────────────
    removeFromWatchlist: "Remove from watchlist",
    addToWatchlist: "Add to watchlist",
    titleLead: "Your",
    titleEm: "watchlist",
    subtitle: "Markets you're tracking, with live prices and 24h moves.",
    statMarkets: "Markets",
    statAvgMove: "Avg move 24h",
    statLive: "Live",
    statEndingSoon: "Ending soon",
    watchingCount: "WATCHING {count} MARKETS",
    moversStrip: "{count} MOVED >5% TODAY",
    endingStrip: "{count} ENDING IN <7 DAYS",
    moversHeadline: "{count} watched markets moved > 5% in 24h",
    allQuiet: "All quiet on your watchlist",
    allQuietBody: "Nothing you're watching moved more than 5% in the last 24 hours.",
    seeMovers: "See movers",
    browseMarkets: "Browse markets",
    searchPlaceholder: "Search your watchlist…",
    tabAll: "All",
    tabMovers: "Movers",
    tabEnding: "Ending soon",
    emptyLead: "You're not watching any markets yet.",
    emptyCta: "Browse markets →",
    noMatches: "No watched markets match these filters.",
    colMarket: "Market",
    col7d: "7D",
    daysLeft: "{n}d",
    trade: "Trade",
    showingCount: "Showing {shown} of {total} watched markets",
    eyebrowHot: "02 · Hot today",
    topMovers: "Top movers",
    seeAll: "See all",
    noMovers: "No big moves among your watched markets.",
    eyebrowEnding: "03 · Closing",
    endingSoonTitle: "Ending soon",
    noEnding: "Nothing ending soon.",
    eyebrowForYou: "04 · For you",
    suggested: "Suggested markets",
    noSuggestions: "No suggestions right now.",
    footerBrand: "kalki.bet · watchlist",
  },

  comments: {
    placeholder: "Share your take…",
    postButton: "Post",
    cancelButton: "Cancel",
    couldntPost: "Couldn't post comment.",
    signInPrompt: "Sign in to join the discussion.",
    emptyState: "No comments yet.",
  },

  share: {
    button: "Share",
    copied: "Copied",
    shared: "Shared.",
    linkCopied: "Link copied to clipboard.",
    couldntCopy: "Couldn't copy — your browser blocked clipboard access.",
    ariaLabel: "Share this market",
  },

  avatar: {
    changeAria: "Change avatar",
    removeAria: "Remove avatar",
    removeConfirm: "Remove your avatar?",
    updated: "Avatar updated.",
    removed: "Avatar removed.",
    removeFailed: "Could not remove avatar.",
    tooLarge: "Image too large — keep it under 2 MB.",
    errUnsupportedType: "Only PNG / JPEG / WebP / GIF are supported.",
    errBadImage: "That file doesn't look like a valid image.",
    errRateLimited: "You're changing avatar too fast. Wait a minute.",
    errNoFile: "Pick a file first.",
    errUploadFailed: "Upload failed.",
  },

  verifyBanner: {
    message: "Verify {email} to confirm your account.",
    sendLink: "Send link",
    sending: "Sending…",
    sent: "Verification email sent. Check your inbox (or dev console).",
    sentBanner:
      "Sent. Click the link in the email (or your dev terminal) to finish verifying {email}.",
    rateLimited: "Wait a bit before requesting again.",
    couldntSend: "Couldn't send email.",
  },

  withdrawForm: {
    amountLabel: "Amount (coins)",
    amountMinMax: "min {min} · max {max}",
    amountPayout: "{amount} coins",
    amountExceeds: "Exceeds wallet balance",
    amountMin: "Min {min}",
    amountInteger: "Enter a whole number",
    methodUpi: "UPI",
    methodBank: "Bank",
    methodCrypto: "Crypto",
    upiLabel: "UPI ID",
    upiPlaceholder: "name@bank",
    accountNumberLabel: "Account number",
    accountNumberPlaceholder: "6-20 digits",
    ifscLabel: "IFSC",
    ifscPlaceholder: "HDFC0001234",
    beneficiaryLabel: "Beneficiary name (as on the bank account)",
    // Global bank transfer
    bankNameLabel: "Bank name",
    bankNamePlaceholder: "e.g. HSBC UK",
    bankCountryLabel: "Bank country",
    bankCountryPlaceholder: "e.g. United Kingdom",
    swiftLabel: "SWIFT / BIC",
    swiftPlaceholder: "e.g. HBUKGB4B",
    ibanLabel: "Account number / IBAN",
    ibanPlaceholder: "Account number or IBAN",
    // Crypto payout
    cryptoNetworkLabel: "Network / asset",
    cryptoAddressLabel: "Wallet address",
    cryptoAddressPlaceholder: "Paste your wallet address",
    errInvalidWallet: "Enter a valid wallet address.",
    submitting: "Submitting…",
    submitButton: "Request withdrawal of {amount} coins",
    submitButtonEmpty: "Request withdrawal",
    submitSuccess: "Withdrawal submitted — we'll email when admin decides.",
    errInsufficientCoins: "Not enough coins in your wallet.",
    errEmailNotVerified: "Verify your email before withdrawing.",
    errRateLimited: "Too many requests — wait before trying again.",
    errForbidden: "Account isn't allowed to withdraw.",
    errInvalidInput: "Check the form — something looks off.",
    errGeneric: "Couldn't submit the request.",
  },

  notifications: {
    heading: "Notifications",
    unreadCount: "{count} unread.",
    allRead: "All read.",
    emptyState:
      "You're all caught up. Trade something to get notifications flowing.",
  },

  achievements: {
    heading: "Achievements",
    subtext:
      "Earn badges by trading, inviting friends, and hitting milestones. XP for every unlock.",
    unlockedCount: "{count}/{total} Unlocked",
    recentlyUnlocked: "Recently unlocked",
    allAchievements: "All achievements",
    unlocksAcrossUsers: "{count} unlocks across all users",
    badge: "Unlocked",
    locked: "Locked",
    reward: "+{coins} 🪙 · +{xp} XP",
    earned: "{count} earned",
    beFirst: "Be the first",
    unlockedTime: "Unlocked {time}",
    signInNote: "Sign in to start earning achievements.",
    createAccount: "Create account",
  },

  kyc: {
    heading: "Identity verification",
    subtext:
      "Required for withdrawals above the platform limit. Submitted documents are encrypted at rest and only visible to a single compliance reviewer.",
    statusLabel: "Current status",
    approved: "Approved ✓",
    approvedNote: "Full withdrawal limits unlocked. No further action needed.",
    approvedFormNote:
      "Your identity is verified. No further documents needed at this time. If your name or address changes, contact support to refresh.",
    rejected: "Rejected",
    rejectionCodeLabel: "Code: {code}",
    resubmitNote: "You can resubmit using the form below.",
    requestMore: "More documents requested",
    pending: "Pending review",
    pendingNote:
      "Typical turnaround is 1 business day. You'll get an in-app notification when the decision lands.",
    pendingFormNote:
      "Your documents are with the reviewer. You'll be notified when a decision lands. To replace a document, contact support.",
    panLabel: "PAN card (front)",
    panHint: "Clear photo of the card. JPG/PNG/PDF up to 5 MB.",
    aadhaarLabel: "Aadhaar card (front + back)",
    aadhaarHint:
      "Mask the first 8 digits of the Aadhaar number if you prefer — the last 4 are sufficient for verification.",
    selfieLabel: "Selfie",
    selfieHint:
      "Face clearly visible, no sunglasses or hat. Used for face-match against PAN.",
    submitButton: "Submit for review",
    resubmitButton: "Resubmit",
    uploadingButton: "Uploading…",
    securityNote:
      "Documents are encrypted at rest using AES-256-GCM with the platform's KMS-wrapped data-encryption key. Only the assigned compliance reviewer can decrypt them, and access is logged in the admin audit trail.",
  },

  activity: {
    waitingForTrades: "Waiting for live trades…",
    liveActivity: "Live activity",
  },

  transaction: {
    signupBonus: "Signup bonus",
    dailyReward: "Daily reward",
    boughtShares: "Bought shares",
    boughtSharesBook: "Bought shares · book leg",
    boughtSharesAmm: "Bought shares · AMM leg",
    soldSharesBook: "Sold shares · book leg",
    soldSharesAmm: "Sold shares · AMM leg",
    limitOrderFilled: "Limit order filled",
    sellOrderFilled: "Sell order filled",
    marketPayout: "Market payout",
    marketRefund: "Market cancelled — refunded",
    adminGrant: "Admin grant",
    referralBonus: "Referral bonus",
    achievementReward: "Achievement reward",
    topUp: "Wallet top-up",
  },
};

export default en;

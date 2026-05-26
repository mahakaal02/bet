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
  },

  nav: {
    home: "Home",
    markets: "Markets",
    portfolio: "Portfolio",
    wallet: "Wallet",
    profile: "Profile",
    leaderboard: "Leaderboard",
    leaderboardMobile: "Top",
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
    leaderboardHeader: "Top traders",
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
    leaderboard: "Loading leaderboard…",
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
  },

  wallet: {
    heading: "Wallet",
    title: "Your wallet",
    subtext: "One balance across markets, auctions and Aviator.",
    currentBalance: "Current balance",
    balance: "Coin balance",
    coins: "coins",
    coinRate: "1 coin = ₹1",
    unified: "Unified",
    unifiedNote: "Same wallet across all Kalki Bet games.",
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
      "1 coin = ₹1. Minimum withdrawal {amount} coins. Admin review is typically same-day.",
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
    razorpayId: "Razorpay payout id (required)",
    markPaid: "Mark paid",
    approvedNote: "Approved — process payout in Razorpay then mark paid.",
    rejectedNote: "Rejected — coins refunded.",
    paidNote: "Marked paid.",
    invalidState: "Already decided — refresh the page.",
    missingReference: "Paste the Razorpay payout id first.",
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
  },

  watchlist: {
    heading: "Watchlist",
    emptyState:
      "You haven't starred any markets yet. Tap the {icon} on a market to add it.",
  },

  notifications: {
    heading: "Notifications",
    unreadCount: "{count} unread.",
    allRead: "All read.",
    emptyState:
      "You're all caught up. Trade something to get notifications flowing.",
  },

  leaderboard: {
    heading: "Leaderboard",
    subtext: "Top traders by total XP. Earn XP by trading — 1 XP per 20 coins spent.",
    emptyState: "No traders yet.",
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

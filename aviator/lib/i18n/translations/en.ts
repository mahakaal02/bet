/**
 * English translations — canonical dictionary (PR-AVIATOR-I18N).
 *
 * The structure here is the contract every other locale dictionary
 * follows. Missing keys in pt/es/fr fall back to whatever string
 * lives at the same key path here (deep-walker in
 * `../index.ts::t`), so a half-translated dictionary never blanks
 * the UI — it just shows the English value until the translator
 * fills it in.
 *
 * Keep keys hierarchical (`game.placeBet`, not `gamePlaceBet`).
 * Two-level depth is the practical limit; deeper than that and the
 * dot-path strings become noise at call sites.
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
    siteName: "Kalki Aviator",
    tagline:
      "Crash-curve betting game — watch the plane climb, cash out before it crashes.",
    description:
      "Real-time multiplier game powered by your Kalki wallet. Place a bet, watch the multiplier rise, cash out before the plane crashes. Provably fair.",
    // ─── Per-page SEO (title + description) ────────────────────
    homeTitle: "Kalki Aviator — crash-curve multiplier game",
    homeDescription:
      "Watch the plane climb, cash out before it crashes. Provably fair multiplier game. One wallet across Kalki Markets, Auctions and Aviator.",
    fairnessTitle: "Provably fair — verify every round",
    fairnessDescription:
      "Every crash multiplier is derived from a committed server seed. Verify any round directly in your browser using the Web Crypto API.",
    profileTitle: "Your account",
    profileDescription:
      "Manage your Kalki account, view your wallet balance, and sign out from all three games.",
    notificationsTitle: "Notifications",
    notificationsDescription:
      "Round crashes, cashout confirmations, and seed rotations land here.",
    withdrawTitle: "Withdraw coins",
    withdrawDescription:
      "Cash out your Kalki coins to UPI or bank. Each request is reviewed before payout.",
    logoutTitle: "Signing you out",
    logoutDescription: "Clearing your Kalki Aviator session.",
  },

  nav: {
    home: "Home",
    profile: "Profile",
    notifications: "Notifications",
    withdraw: "Withdraw",
    fairness: "Fairness",
    logout: "Sign out",
    backToGame: "Back to game",
    backToAviator: "Back to Aviator",
    backToKalkiHub: "Back to Kalki hub",
    myStats: "My stats",
  },

  switcher: {
    label: "Language",
    chooseLanguage: "Choose your language",
  },

  common: {
    loading: "Loading…",
    error: "Error",
    save: "Save",
    cancel: "Cancel",
    submit: "Submit",
    continue: "Continue",
    back: "Back",
    close: "Close",
    coins: "coins",
    online: "Online",
  },

  game: {
    // ─── Phase pills (top of stage) ───────────────────────────
    startsIn: "Starts in",
    almost: "Almost!",
    inFlight: "In flight",
    crashed: "Crashed",
    connecting: "Connecting",
    connectingToArena: "Connecting to arena…",
    reconnecting: "Reconnecting…",

    // ─── Bet controls ─────────────────────────────────────────
    bet: "Bet",
    auto: "Auto",
    betAmount: "Bet amount in coins",
    autoCashoutAt: "Auto cashout at",
    autoCashoutAria: "Auto cashout multiplier",
    placeBet: "BET",
    placeBetHero: "PLACE BET",
    topUpToBet: "TOP UP TO BET",
    topUpToBetSub: "Add coins",
    cashout: "CASHOUT",
    busted: "BUSTED",
    betPlaced: "BET PLACED",
    waitingForRound: "coins · waiting for round",
    waitForNextRound: "WAIT FOR NEXT ROUND",
    bettingOpensSoon: "Betting opens in a few seconds",
    cashedOut: "CASHED OUT",
    waitingForFinish: "Waiting for round to finish",
    maxPayoutReached: "MAX PAYOUT REACHED",
    autoCashedOut: "Auto cashed out",
    waiting: "WAITING…",

    // ─── Stake feedback ───────────────────────────────────────
    minBetCoins: "Minimum bet is {min} coins",
    minBet: "Min bet {min} coins",
    walletHasOnly: "Wallet has only {amount}",
    walletHasTopUp: "Wallet has {amount} — top up to place this bet.",
    autoCashoutMinError: "Auto cashout must be at least 1.01×",
    cashedOutAt: "Cashed out @ {multiplier}× · +{coins}",
    wallet: "Wallet",
    maxChip: "Max",

    // ─── History strip ────────────────────────────────────────
    recent: "Recent",
    waitingForFirstRound: "Waiting for first round…",
    roundHistory: "Round History",
    showFullHistory: "Show full round history",
    closeRoundHistory: "Close round history",
    noRoundsYet: "No rounds yet. The first crash you see will land here.",
    roundLabel: "Round #{n} — {tier}",

    // ─── Roster / winners ─────────────────────────────────────
    players: "Players",
    betVolume: "Bet volume",
    paidOut: "Paid out",
    noBetsYet: "No bets yet for this round.",
    waitingForNextRound: "Waiting for next round…",
    cashedOutCount: "Cashed out · {count}",
    autoCashoutTarget: "Auto-cashout target",
    autoLabel: "auto",
    recentWinners: "Recent winners",
    noCashoutsYet: "No cashouts yet this session.",

    // ─── Chat ─────────────────────────────────────────────────
    liveChat: "Live chat",
    chatPlaceholder: "Say something…",
    chatBeFirst: "Be the first to say something.",
    chatYou: "you",
    chatSend: "Send",
    chatSendFailed: "send failed",
  },

  wallet: {
    balance: "Wallet balance",
    topUp: "+ Top up",
    encash: "Encash",
    topUpTitle: "Top up your wallet",
    manageWallet: "Manage wallet",
    encashUnlocks:
      "Encash unlocks at {min} — {remaining} to go.",
    encashTooltipUnlocked: "Withdraw to your bank / UPI",
    encashTooltipLocked: "Reach {min} to enable withdrawals",
    minWithdraw: "min {amount} coins",
    unifiedWallet: "Unified wallet",
    unifiedNote: "Same balance across Auctions, Aviator, and Kalki Exchange.",
  },

  fairness: {
    title: "Provably fair",
    description:
      "Every Aviator round's crash multiplier is derived from a server seed committed before the round (its hash is public) and a deterministic client seed. The seed is revealed when the batch rotates — at which point anyone can recompute every round's crash multiplier and check the server didn't cheat. Click Verify on any past round below to recompute it right in your browser.",
    activeSeed: "Active seed",
    noActiveSeed: "No active seed.",
    seedHidden:
      "The serverSeed itself is hidden until rotation — that's the commitment.",
    recentRounds: "Recent rounds",
    columnRound: "Round",
    columnCrash: "Crash",
    columnNonce: "Nonce",
    columnSeedStatus: "Seed status",
    seedRevealed: "revealed (batch rotated)",
    seedVerifiable: "verifiable",
    verify: "verify",
    verifying: "verifying…",
    revealedBatches: "Revealed seed batches",
    noBatchesYet:
      "No batches rotated yet. Once an admin rotates the active seed (or the auto-rotation ceiling fires), the seed appears here with the range of rounds it covered.",
    rangeRounds: "rounds #{from}–#{to}",
    howItWorks: "How verification works",
    howItWorksBody:
      "For each round we compute HMAC-SHA256(serverSeed, \"{clientSeed}:{nonce}\"). Slice the first 13 hex characters as an integer e; the crash multiplier is floor(100 · 2^52 / (2^52 − e)) / 100, floored to two decimals — except 1 in 33 rounds (≈3% house edge) which insta-crash at 1.00. The verify button does this in your browser using the Web Crypto API.",
  },

  notifications: {
    heading: "Notifications",
    subtext:
      "Round crashes, cashout confirmations, and seed rotations will land here.",
    emptyState: "You're all caught up.",
  },

  profile: {
    backToAviator: "← Back to Aviator",
    account: "Account",
    unifiedWallet: "Unified wallet",
    unifiedNote: "Same balance across Auctions, Aviator, and Kalki Exchange.",
    signOut: "Sign out",
    signOutAllDescription:
      "Signs you out of all three Kalki games and clears your session on this device.",
    signOutButton: "Sign out of all games",
    signingOut: "Signing out…",
    defaultEmail: "WhatsApp / email account",
  },

  withdraw: {
    opening: "Opening withdrawal…",
    redirecting: "Redirecting to the Kalki wallet to submit your request.",
  },

  logout: {
    signingOut: "Signing you out…",
    bridging: "Bridging your Kalki Aviator session — this only happens once per launch.",
  },

  stats: {
    title: "My Stats",
    closeAria: "Close stats",
    rangeDay: "Day",
    rangeWeek: "Week",
    rangeMonth: "Month",
    rangeAll: "All",
    biggestX: "Biggest X",
    biggestWin: "Biggest Win",
    totalBets: "Total Bets",
    winRate: "Win Rate",
    wagered: "Wagered",
    netPL: "Net P/L",
    winsLosses: "{wins} won · {losses} lost",
    loading: "Loading stats…",
    loadFailed: "Could not load stats",
    footnoteDay: "Last 24 hours · sampled from your 200 most recent bets",
    footnoteWeek: "Last 7 days · sampled from your 200 most recent bets",
    footnoteMonth: "Last 30 days · sampled from your 200 most recent bets",
    footnoteAll: "Since account creation · sampled from your 200 most recent bets",
  },

  errors: {
    genericNetwork: "Network error. Try again.",
    signedOut: "Please sign in.",
    insufficientBalance: "Not enough coins in your wallet.",
    couldntLoad: "Could not load.",
  },
};

export default en;

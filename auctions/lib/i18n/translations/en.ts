/**
 * English translations — canonical dictionary (PR-AUCTIONS-I18N).
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
    siteName: "Kalki Auctions",
    tagline:
      "Lowest-unique-bid auctions powered by Kalki coins — the same wallet that powers the prediction markets and Aviator.",
    description:
      "Bid on real products with Kalki coins. Lowest unique bid wins. One wallet across Auctions, Aviator and the Exchange.",
    // ─── Per-page SEO (title + description) ────────────────────
    homeTitle: "Kalki — pick a game, one wallet",
    homeDescription:
      "Three games, one wallet. Auctions, Aviator, and the Kalki Exchange. Pick where to spend your coins.",
    auctionsTitle: "Live auctions — bid lowest unique to win",
    auctionsDescription:
      "Browse live, upcoming and closed auctions. Pay coins per bid and the lowest unique bid wins a real product.",
    auctionDetailTitle: "Auction detail",
    auctionDetailDescription:
      "Place a bid on this auction. Lowest unique bid wins — see the live status and time remaining.",
    profileTitle: "Your profile",
    profileDescription:
      "Manage your account, addresses, KYC, security and referrals across the Kalki product suite.",
    notificationsTitle: "Notifications",
    notificationsDescription:
      "Order updates, bid status, support replies and rewards — everything that happened while you were away.",
    loginTitle: "Sign in to Kalki",
    loginDescription:
      "Sign in to bid on auctions, manage your wallet and follow your favourite items.",
    forgotTitle: "Reset your password",
    forgotDescription:
      "Forgot your password? Enter your email to receive a reset link.",
    resetTitle: "Choose a new password",
    resetDescription:
      "Set a new password for your Kalki account.",
    watchlistTitle: "Watchlist",
    watchlistDescription:
      "Your starred auctions — quick access to the items you're tracking.",
    ordersTitle: "My orders",
    ordersDescription:
      "Items you've won. Track shipping, open a dispute, set a delivery address.",
    kycTitle: "Identity verification",
    kycDescription:
      "Verify identity to unlock higher withdrawal limits. Documents are encrypted at rest.",
    addressesTitle: "Shipping addresses",
    addressesDescription:
      "Where wins ship to — up to 10 addresses, one default.",
    twofaTitle: "Two-factor authentication",
    twofaDescription:
      "Add an authenticator-app code to sign-in for extra security.",
    referralsTitle: "Refer a friend",
    referralsDescription:
      "Share your code — when someone signs up with it you both get bonus coins.",
    supportTitle: "Support tickets",
    supportDescription:
      "Stuck on something? Tell us — we reply within hours.",
    dailyTitle: "Daily login reward",
    dailyDescription:
      "Bigger reward each day — bonuses on day 7, 14, and 30.",
    rgTitle: "Responsible gambling",
    rgDescription:
      "Set wager limits, request a cool-down, or self-exclude. Help available at 1800-599-0019.",
    deleteTitle: "Close account & data export",
    deleteDescription:
      "30-day cool-off · download your data anytime.",
    emailTitle: "Change email",
    emailDescription:
      "Both current and new email must confirm before it applies.",
  },

  nav: {
    home: "Home",
    auctions: "Auctions",
    games: "Games",
    profile: "Profile",
    notifications: "Notifications",
    watchlist: "Watchlist",
    signIn: "Sign in",
    signOut: "Sign out",
    register: "Sign up",
  },

  hub: {
    pickProduct: "Pick a product to dive in. Your coins move with you — same wallet across all three.",
    pickProductAdmin: "Pick a product to manage. Each tile opens its admin console.",
    greeting: "Hi {handle}",
    adminBadge: "Admin",
    auctionsTitle: "Live Auctions",
    auctionsTagline: "Lowest unique bid wins. Each bid costs coins from your wallet.",
    auctionsAdminTagline: "Manage live auctions, close rounds, inspect bids.",
    aviatorTitle: "Aviator",
    aviatorTagline: "Cash out before the multiplier crashes.",
    aviatorAdminTagline: "Analytics, round log, seeds, chat moderation.",
    exchangeTitle: "Kalki Exchange",
    exchangeTagline: "Trade YES / NO shares on prediction markets.",
    exchangeAdminTagline: "Markets, users, withdrawals, comment moderation.",
    open: "Open →",
    coinsInWallet: "{coins} coins in your wallet.",
    topUpWallet: "Top up wallet →",
  },

  common: {
    loading: "Loading…",
    error: "Something went wrong.",
    save: "Save",
    cancel: "Cancel",
    submit: "Submit",
    continue: "Continue",
    back: "← Back",
    next: "Next",
    close: "Close",
    edit: "Edit",
    delete: "Delete",
    confirm: "Confirm",
    coins: "coins",
    sending: "Sending…",
    saving: "Saving…",
    submitting: "Submitting…",
    retry: "Try again",
  },

  switcher: {
    label: "Language",
    chooseLanguage: "Choose your language",
  },

  auth: {
    // ─── Common form labels ────────────────────────────────────
    emailLabel: "Email",
    passwordLabel: "Password",
    usernameLabel: "Username",
    emailPlaceholder: "you@example.com",

    // ─── Sign in ───────────────────────────────────────────────
    signInTitle: "Sign in to Kalki",
    signInButton: "Sign in",
    signingInButton: "Signing in…",
    forgotPasswordLink: "Forgot password?",
    needAccount: "Don't have an account?",
    registerLink: "Create one",
    invalidCredentials: "Invalid email or password.",
    telegramContinue: "Continue with Telegram",

    // ─── Register ──────────────────────────────────────────────
    registerTitle: "Create your Kalki account",
    createAccountButton: "Create account",
    creatingAccountButton: "Creating account…",
    alreadyRegistered: "Already registered?",
    signInLink: "Sign in",

    // ─── Forgot / reset password ───────────────────────────────
    forgotHeading: "Reset password",
    forgotSubtext:
      "We'll email you a one-time link to set a new password. The link expires in 30 minutes.",
    forgotSendButton: "Send reset link",
    forgotSendingButton: "Sending…",
    forgotSuccess:
      "If {email} is registered, you'll receive a reset link shortly.",
    forgotRememberedIt: "Remembered it?",
    forgotBackToSignIn: "Back to sign in",

    resetHeading: "Choose a new password",
    newPasswordLabel: "New password",
    confirmPasswordLabel: "Confirm password",
    updatePasswordButton: "Update password",
    updatingPasswordButton: "Updating…",
    invalidOrExpiredLink: "This link is invalid or has expired.",
    passwordUpdatedSignIn: "Password updated. Please sign in.",
    requestNewLink: "Request a new link →",

    // ─── 2FA challenge ─────────────────────────────────────────
    twofaChallenge: "Two-factor code",
    twofaPlaceholder: "6-digit code",
    twofaSubmit: "Verify",
    twofaBackupCode: "Use a backup code instead",
    twofaTrustDevice: "Trust this device for 30 days",
    twofaInvalid: "That code didn't work — try again.",

    // ─── Sign out ──────────────────────────────────────────────
    signOutButton: "Sign out of all games",
    signOutDescription:
      "Signs you out of all three Kalki games and clears your session on this device.",

    // ─── Validation / errors ───────────────────────────────────
    rateLimited: "Too many attempts — please wait a minute.",
    tooManyRequests: "Too many requests — wait a bit.",
    weakPassword: "Use 8+ characters with a mix of letters and numbers.",
    emailTaken: "That email is already registered.",
    genericError: "Something went wrong. Try again.",
  },

  auction: {
    // ─── List page ─────────────────────────────────────────────
    heading: "Auctions",
    subtext:
      "Lowest-unique-bid auctions. Browse below — sign in to place bids and watch your standing update in real time.",
    tabLive: "Live",
    tabUpcoming: "Upcoming",
    tabClosed: "Closed",
    statusLive: "Live",
    statusUpcoming: "Upcoming",
    statusEnded: "Ended",
    emptyLive: "Nothing live right now. Check the Upcoming tab.",
    emptyUpcoming: "No upcoming auctions scheduled.",
    emptyEnded: "No closed auctions yet — the recent ones will land here.",
    fetchError: "Couldn't reach the auctions service: {error}.",
    // ─── Tile / row ────────────────────────────────────────────
    retailPrice: "Retail price",
    coinsPerBid: "Coins per bid",
    coinsPerBidValue: "{n} coin",
    coinsPerBidValuePlural: "{n} coins",
    timeStartsSoon: "starts soon",
    timeStartsIn: "starts {time}",
    timeEndingNow: "ending…",
    timeEndsIn: "ends {time}",
    timeEndedAt: "ended {time}",
    timeEnded: "ended",
    winnerNoneDeclared: "No winner declared.",
    winnerWonAt: "won at",
    // ─── Detail page ───────────────────────────────────────────
    backAll: "← All auctions",
    winner: "Winner",
    placeBidHeading: "Place a bid",
    howItWorksHeading: "How it works",
    howItWorks1: "Each bid costs {coins} coin{s} from your wallet.",
    howItWorks2: "Pick any number from 0.01 up to retail price.",
    howItWorks3:
      "When the timer hits zero, the lowest unique bid wins the product.",
    aboutThisItem: "About this item",
    // ─── Bid panel ─────────────────────────────────────────────
    bidNow: "Place bid",
    bidAmountLabel: "Bid amount",
    bidPlacing: "Placing…",
    bidSuccess: "Bid placed.",
    bidErrorInsufficientCoins:
      "Not enough coins. Top up your wallet to keep bidding.",
    bidErrorAuctionClosed: "This auction is no longer accepting bids.",
    bidErrorRateLimited: "Slow down — wait before bidding again.",
    bidErrorInvalidAmount: "Pick an amount between 0.01 and the retail price.",
    bidErrorGeneric: "Could not place bid.",
    bidErrorSignedOut: "Please sign in to bid.",
    bidSignInPrompt: "Sign in to place a bid.",
    // ─── Watch toggle ──────────────────────────────────────────
    watch: "Watch",
    watching: "Watching",
    watchToggleError: "Couldn't update watchlist.",
  },

  profile: {
    heading: "Profile",
    backToHub: "← Back to hub",
    noEmail: "no email on file",
    adminBadge: "admin",
    // ─── Sections (top-level cards) ────────────────────────────
    sectionAccount: "Account",
    sectionProfile: "Profile",
    sectionSecurity: "Security",
    sectionRG: "Responsible gambling",
    sectionDaily: "Daily reward",
    sectionEmail: "Account",
    sectionShipping: "Shipping",
    sectionIdentity: "Identity",
    sectionReferrals: "Refer a friend",
    sectionOrders: "Orders",
    sectionHelp: "Help",
    sectionDanger: "Danger zone",
    sectionSignOut: "Sign out",
    // ─── Account ───────────────────────────────────────────────
    unifiedWallet: "Unified wallet",
    coinsValue: "{coins} coins",
    unifiedNote: "Same balance across Auctions, Aviator, and Kalki Exchange.",
    // ─── Cards ─────────────────────────────────────────────────
    displayNameTitle: "Display name & avatar",
    displayNameSubtext:
      "Your public face on Kalki — renamable once every 30 days",
    twofaTitle: "Two-factor authentication",
    twofaSubtext: "Add an authenticator-app code to sign-in",
    rgTitle: "Limits, cool-down, self-exclude",
    rgSubtext: "Set wager limits or take a break — help available at 1800-599-0019",
    dailyTitle: "Daily login streak",
    dailySubtext: "Bigger reward each day — bonuses on day 7, 14, and 30",
    emailTitle: "Change email",
    emailSubtext: "Both current and new email must confirm before it applies",
    addressesTitle: "Shipping addresses",
    addressesSubtext: "Where wins ship to — up to 10, one default",
    kycTitle: "KYC verification",
    kycSubtext: "Verify identity to unlock higher withdrawal limits",
    referralsTitle: "Share your code",
    referralsSubtext: "Earn coins when a friend signs up and tops up",
    ordersTitle: "Track shipments",
    ordersSubtext: "Items you've won — pick an address, watch them arrive",
    supportTitle: "Support tickets",
    supportSubtext: "Stuck on something? Tell us — we reply within hours",
    deleteTitle: "Close account & data export",
    deleteSubtext: "30-day cool-off · download your data anytime",
  },

  me: {
    // Each /me/* sub-page heading + subtext
    profileHeading: "Profile",
    profileSubtext:
      "Your @{handle} handle is the unique identifier (visible in bid timelines + transfer receipts). Your display name + avatar are what other users see in feeds.",
    accountLink: "← Account",

    dailyHeading: "Daily login reward",
    dailySubtext:
      "Sign in every day to grow your streak. Bigger reward on day 7, 14, and 30.",
    dailyClaim: "Claim today's reward",
    dailyClaimed: "Claimed",
    dailyStreak: "{days}-day streak",

    twofaHeading: "Two-factor authentication",
    twofaSubtext:
      "Add an authenticator-app code to your sign-in. Use Google Authenticator, 1Password, Authy or similar.",
    twofaEnable: "Enable 2FA",
    twofaDisable: "Disable 2FA",
    twofaEnabled: "2FA is enabled",

    addressesHeading: "Shipping addresses",
    addressesSubtext:
      "Up to 10 addresses. One default — used when you win an auction unless you pick a different one.",
    addressesAdd: "Add new address",
    addressesEmpty: "No addresses yet. Add one before winning your first auction.",
    addressesMakeDefault: "Make default",
    addressesDefault: "Default",
    addressesDelete: "Delete",

    kycHeading: "Identity verification",
    kycSubtext:
      "Required to unlock higher withdrawal limits. Submitted documents are encrypted at rest.",
    kycSubmit: "Submit for review",
    kycPending: "Pending review",
    kycApproved: "Approved",
    kycRejected: "Rejected — resubmit below",

    ordersHeading: "My orders",
    ordersSubtext:
      "Items you've won. Track shipping, open a dispute, set a delivery address.",
    ordersEmpty: "No orders yet. Win an auction and one will show up here.",
    ordersOpenAddress: "Pick a shipping address",
    ordersAwaiting: "Awaiting fulfilment",
    ordersInTransit: "In transit",
    ordersDelivered: "Delivered",
    ordersDisputed: "Disputed",
    ordersCancelled: "Cancelled",
    ordersTrack: "Track →",
    ordersOpenDispute: "Open dispute",

    referralsHeading: "Refer a friend",
    referralsSubtext:
      "Share your code. When a friend signs up and makes their first top-up you both earn bonus coins.",
    referralsCodeLabel: "Your code",
    referralsCopy: "Copy",
    referralsCopied: "Copied",
    referralsClaim: "Claim bonus",

    supportHeading: "Support tickets",
    supportSubtext:
      "Stuck on something? Tell us — we reply within hours during business hours.",
    supportNew: "New ticket",
    supportEmpty: "No tickets yet. Open one and we'll get back to you.",
    supportOpen: "Open",
    supportClosed: "Closed",
    supportPlaceholder: "Describe what went wrong…",
    supportSend: "Send",

    watchlistHeading: "Watchlist",
    watchlistSubtext:
      "Auctions you've starred. We'll notify you before each one closes.",
    watchlistEmpty:
      "You haven't starred any auctions yet. Tap the star on an auction tile to add it.",

    emailHeading: "Change email",
    emailSubtext:
      "Both your current email and the new one need to confirm before the change applies. We'll send a link to each.",
    emailNewLabel: "New email",
    emailRequestChange: "Request change",
    emailRequestPending:
      "Pending — check both inboxes for a confirmation link.",
    emailCancelChange: "Cancel pending change",

    deleteHeading: "Close account",
    deleteSubtext:
      "Closes your Kalki account across all three games. 30-day cool-off — if you change your mind, sign in again before then to cancel.",
    deleteConfirmLabel: "Type DELETE to confirm",
    deleteButton: "Close my account",
    dataExport: "Download my data",
    dataExportSubtext:
      "GDPR-compliant export of your account, wallet history and bids in JSON.",

    rgHeading: "Responsible gambling",
    rgSubtext:
      "Set limits on how much you can wager. You can lower limits instantly, but raising them requires a 24-hour cooling period.",
    rgCooldown: "Take a cool-down",
    rgSelfExclude: "Self-exclude",
    rgWeeklyLimit: "Weekly limit",
    rgDailyLimit: "Daily limit",
    rgSessionLimit: "Session limit",
    rgHelpline:
      "If you need help, call 1800-599-0019 (KIRAN — mental health helpline, India).",
  },

  notifications: {
    heading: "Notifications",
    subtext:
      "Order updates, bid status, support replies and rewards — everything that happened while you were away.",
    unreadCount: "{count} unread",
    allRead: "All read.",
    markAllRead: "Mark all read",
    emptyState:
      "You're all caught up. Place a bid to start getting notifications.",
    preferencesHeading: "Notification preferences",
    preferencesEmail: "Email me about",
    preferencesPush: "Push notifications",
  },

  share: {
    button: "Share",
    copied: "Copied",
    shared: "Shared.",
    linkCopied: "Link copied to clipboard.",
    couldntCopy: "Couldn't copy — your browser blocked clipboard access.",
    ariaLabel: "Share this auction",
  },

  errors: {
    genericNetwork: "Network error. Try again.",
    signedOut: "Please sign in.",
    notFound: "Page not found",
    notFoundDescription: "The page you're looking for doesn't exist or has moved.",
    backHome: "Back to home",
    generic: "Something went wrong.",
    unauthorized: "Please sign in.",
    forbidden: "You don't have access to this page.",
    serverError: "Server error. Please try again shortly.",
  },

  toast: {
    saved: "Saved.",
    copied: "Copied.",
    error: "Something went wrong.",
    submitted: "Submitted.",
  },

  topup: {
    label: "Top up",
    coinsLabel: "coins",
    open: "Open wallet",
  },
};

export default en;

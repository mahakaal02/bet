import type { Dictionary } from "./en";

/**
 * French (fr-FR baseline). Same fallback semantics as pt.ts/es.ts —
 * missing keys defer to en.ts via the deep walker.
 *
 * Style: Metropolitan French (Hexagone). Crypto/markets jargon kept
 * close to industry usage ("trader", "marché de prédiction") which
 * native French traders use untranslated.
 */
const fr: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Exchange",
    tagline:
      "Tradez OUI/NON sur des événements réels avec vos coins Kalki Bet — le même portefeuille qui alimente les enchères et Aviator.",
    description:
      "Marchés de prédiction, enchères en direct et crash-game — un portefeuille, trois produits, tout en coins démo.",
  },

  nav: {
    home: "Accueil",
    markets: "Marchés",
    portfolio: "Portefeuille",
    wallet: "Portefeuille",
    profile: "Profil",
    leaderboard: "Classement",
    leaderboardMobile: "Top",
    watchlist: "Favoris",
    achievements: "Succès",
    notifications: "Notifications",
    admin: "Admin",
    signIn: "Connexion",
    signOut: "Déconnexion",
    register: "S'inscrire",
  },

  landing: {
    heroKicker: "Prédisez. Tradez. Gagnez.",
    heroTitle: "Événements réels. Opinions réelles. Enjeux réels.",
    heroDescription:
      "Choisissez un camp, fixez votre prix, regardez le marché bouger. Retirez à tout moment avant la résolution de l'événement.",
    ctaPrimary: "Voir les marchés",
    ctaSecondary: "Comment ça marche",
    statsMarkets: "Marchés actifs",
    statsUsers: "Joueurs",
    statsTrades: "Échanges effectués",
    trendingHeader: "Marchés tendance",
    leaderboardHeader: "Meilleurs traders",
  },

  forms: {
    required: "Requis",
    optional: "Facultatif",
    save: "Enregistrer",
    cancel: "Annuler",
    submit: "Envoyer",
    edit: "Modifier",
    delete: "Supprimer",
    back: "← Retour",
    loading: "Chargement…",
    sending: "Envoi…",
  },

  loading: {
    generic: "Chargement…",
    markets: "Chargement des marchés…",
    wallet: "Chargement du portefeuille…",
    portfolio: "Chargement du portefeuille…",
    profile: "Chargement du profil…",
    leaderboard: "Chargement du classement…",
  },

  validation: {
    required: "Champ requis.",
    emailInvalid: "Saisissez une adresse e-mail valide.",
    passwordMinLength: "Le mot de passe doit comporter au moins 8 caractères.",
    passwordsDontMatch: "Les mots de passe ne correspondent pas.",
    invalidInput: "Vérifiez les erreurs du formulaire.",
  },

  toast: {
    saved: "Enregistré.",
    copied: "Copié.",
    error: "Une erreur s'est produite.",
    submitted: "Envoyé pour examen.",
    coins: "coins",
  },

  switcher: {
    label: "Langue",
    chooseLanguage: "Choisissez votre langue",
  },

  banner: {
    geoSuggest: "Voir ce site en {language} ?",
    geoSuggestYes: "Oui, changer",
    geoSuggestNo: "Rester en anglais",
  },

  errors: {
    notFound: "Page introuvable",
    notFoundDescription: "La page recherchée n'existe pas ou a été déplacée.",
    backHome: "Retour à l'accueil",
    generic: "Une erreur s'est produite.",
    network: "Erreur réseau. Réessayez.",
    unauthorized: "Veuillez vous connecter.",
  },

  auth: {
    emailLabel: "E-mail",
    passwordLabel: "Mot de passe",
    usernameLabel: "Nom d'utilisateur",
    usernamePlaceholder: "3–20 caractères, lettres/chiffres/underscore",
    referralCodeLabel: "Code de parrainage (facultatif)",
    referralCodePlaceholder: "ABC123",
    forgotEmailPlaceholder: "vous@exemple.com",
    backButton: "← Retour",
    backToSignIn: "← Retour à la connexion",

    signInTitle: "Connexion à Kalki Exchange",
    welcomeHeading: "Bon retour",
    welcomeSubtext:
      "Connectez-vous pour trader sur les marchés de prédiction avec vos coins Kalki Bet.",
    signInButton: "Se connecter",
    signingInButton: "Connexion…",
    googleSignIn: "Continuer avec Google",
    forgotPasswordLink: "Mot de passe oublié ?",
    needAccount: "Pas encore de compte ?",
    registerLink: "Créez-en un",
    invalidCredentials: "E-mail ou mot de passe incorrect.",

    registerTitle: "Créez votre compte Kalki",
    createAccountHeading: "Créez votre compte",
    createSubtext:
      "On vous crédite 10 000 coins de démarrage instantanément — ils fonctionnent sur les marchés, les enchères et Aviator.",
    createAccountButton: "Créer un compte",
    creatingAccountButton: "Création…",
    alreadyRegistered: "Déjà inscrit ?",
    signInLink: "Se connecter",
    signUpSuccess: "Bienvenue ! 10 000 coins de démarrage sont dans votre portefeuille.",

    forgotPasswordHeading: "Mot de passe oublié",
    forgotPasswordSubtext:
      "Saisissez votre e-mail ; nous enverrons un lien de réinitialisation s'il existe un compte associé.",
    forgotSendButton: "Envoyer le lien",
    forgotSendingButton: "Envoi…",
    forgotSuccess:
      "✅ Si {email} est enregistré, vous recevrez un lien sous peu. Le lien expire dans 1 heure.",
    forgotDevNote: "Dev : consultez la console serveur Next.js pour le lien.",
    couldntSendLink: "Impossible d'envoyer le lien.",

    chooseNewPasswordHeading: "Choisissez un nouveau mot de passe",
    newPasswordLabel: "Nouveau mot de passe",
    confirmPasswordLabel: "Confirmer le mot de passe",
    updatePasswordButton: "Mettre à jour le mot de passe",
    updatingPasswordButton: "Mise à jour…",
    invalidOrExpiredLink: "Ce lien est invalide ou a expiré.",
    couldntResetPassword: "Impossible de réinitialiser le mot de passe.",
    passwordUpdatedSignedIn: "Mot de passe mis à jour. Vous êtes maintenant connecté.",
    passwordUpdatedSignIn: "Mot de passe mis à jour. Veuillez vous connecter.",
    missingResetToken: "Jeton de réinitialisation manquant.",
    requestNewLink: "Demander un nouveau lien →",

    emailVerificationHeading: "Vérification de l'e-mail",
    verifyingLink: "Vérification de votre lien…",
    verifySuccess: "✅ Votre e-mail est vérifié. Bienvenue à bord.",
    continueProfileButton: "Continuer vers le profil",
    verifyInvalidLink: "Ce lien est invalide ou a expiré.",
    requestNewVerifyLink: "En demander un nouveau →",

    signOut: "Déconnexion",
    signOutAll:
      "Vous déconnecte des trois jeux Kalki et efface votre session sur cet appareil.",
    signOutButton: "Se déconnecter de tous les jeux",
    signingOutButton: "Déconnexion…",
    signingYouIn: "Connexion en cours…",
    bridgingSession:
      "Connexion de votre session Kalki Bet — cela ne se produit qu'une fois par lancement.",

    emailTaken: "Cet e-mail est déjà enregistré.",
    usernameTaken: "Ce nom d'utilisateur est déjà pris.",
    rateLimited: "Trop de tentatives — patientez une minute.",
    tooManyRequests: "Trop de requêtes — attendez un peu.",
    invalidInput: "Vérifiez les erreurs du formulaire.",
    createError: "Impossible de créer le compte.",
    weakPassword: "Utilisez 8+ caractères avec des lettres et des chiffres.",
  },

  market: {
    yes: "OUI",
    no: "NON",
    volume: "Volume",
    liquidity: "Liquidité",
    midPrice: "Prix médian",
    ends: "Fin",
    endsDate: "Fin le {date}",
    created: "Créé",
    resolved: "Résolu",
    resolvedOutcome: "Résolu {outcome}",
    cancelled: "Annulé",
    featured: "À la une",
    placeBet: "Parier",
    cashOut: "Encaisser",
    orderBook: "Carnet d'ordres",
    trades: "Échanges",
    recentTrades: "Échanges récents",
    noTrades: "Aucun échange pour le moment.",
    totalTrades: "{count} au total",
    comments: "Commentaires",
    commentsCount: "{count} commentaires",
    discussion: "Discussion",
    marketStats: "Statistiques du marché",
    priceHistory: "Historique des prix",
    resolutionSource: "Source de résolution :",
    resolution: "Résolution :",
    heading: "Marchés",
    searchPlaceholder: "Rechercher des marchés…",
    sortTrending: "Tendance",
    sortVolume: "Volume",
    sortEnding: "Se terminent bientôt",
    sortNewest: "Les plus récents",
    filterOpen: "Ouverts",
    filterResolved: "Résolus",
    filterAll: "Tous",
    applyButton: "Appliquer",
    categoryAll: "Toutes",
    categoryPolitics: "Politique",
    categorySports: "Sports",
    categoryCrypto: "Crypto",
    categoryTech: "Tech",
    categoryEnt: "Divert.",
    noMatches: "Aucun marché ne correspond à ces filtres.",
    marketCount: "{count} marché{s} {status}",
    notFound: "Marché introuvable",
    shares: "parts",
    vol: "Vol",
    liq: "liq.",
    statusOpen: "ouverts",
    statusResolved: "résolus",
    statusClosed: "fermés",
    statusCancelled: "annulés",
  },

  wallet: {
    heading: "Portefeuille",
    title: "Votre portefeuille",
    subtext: "Un solde unique sur les marchés, les enchères et Aviator.",
    currentBalance: "Solde actuel",
    balance: "Solde de coins",
    coins: "coins",
    coinRate: "1 coin = ₹1",
    unified: "Unifié",
    unifiedNote: "Le même portefeuille sur tous les jeux Kalki Bet.",
    unifiedPromise:
      "Un solde unique sur les Marchés, les Enchères et Aviator. Chaque rechargement apparaît dans votre historique des transactions.",
    securityNote:
      "Un solde unique sur les Marchés, les Enchères et Aviator. Chaque rechargement apparaît dans votre historique des transactions.",
    buyCoins: "Acheter des coins",
    withdraw: "Retirer",
    minWithdraw: "min. {amount} coins",
    withdrawSubtext:
      "Retirez vos coins vers votre compte UPI ou bancaire. Chaque demande passe par un examen administrateur avant paiement.",
    requestWithdrawal: "Demander un retrait",
    verifyEmailNote:
      "Vérifiez votre e-mail avant de demander un retrait. Ouvrez la page de profil et cliquez sur \"Envoyer le lien\".",
    inReview: "En examen",
    recentActivity: "Activité récente",
    fullLedger: "Historique complet →",
    noActivity: "Aucune activité pour le moment.",
    tapToTopup: "Portefeuille — touchez pour recharger",
    payWithCrypto:
      "Payez en crypto — BTC, ETH, USDT, USDC et 200+ autres. Vos coins arrivent automatiquement dès que le paiement est confirmé on-chain.",
    askAdmin: "Contactez un admin sur Secure Kalki Chat pour les paiements",
    downloadChatApp: "Télécharger Secured Chat App maintenant",
    chatAppMessage: "Contactez un admin sur Secure Kalki Chat pour les paiements",
    chatAppDownload:
      "Pour les rechargements de coins, envoyez un message à un admin sur Secured Kalki Chat. Téléchargez Secured Chat App maintenant ↓",
    chatAppNoUrl:
      "Pour les rechargements de coins, envoyez un message à un admin sur Secured Kalki Chat. (Lien de téléchargement non configuré — demandez au super admin de le définir dans /admin/settings.)",
    paymentWidgetError: "Le widget de paiement ne s'est pas chargé. Rafraîchissez et réessayez.",
    alreadyCredited: "Déjà crédité.",
    creditsBalance: "+{coins} coins · solde {balance}",
    alreadyCreditedPack: "Déjà crédité — essayez un autre pack.",
    unknownPack: "Ce pack n'est pas disponible.",
    slowDown: "Doucement — attendez une minute avant de racheter.",
    noPaymentConfig: "Les paiements ne sont pas configurés. Contactez un admin.",
    orderCreateFailed: "Impossible de créer l'ordre de paiement. Réessayez.",
    badSignature:
      "Échec de la vérification du paiement. Contactez le support si vous avez été débité.",
    instantDisabled: "Le rechargement instantané est désactivé. Utilisez le flux de paiement.",
    unauthorized: "Veuillez vous connecter.",
    topUpFailed: "Échec du rechargement. Réessayez.",
  },

  withdraw: {
    heading: "Retirer des coins",
    subtext:
      "1 coin = ₹1. Retrait minimum {amount} coins. L'examen administrateur est généralement effectué le jour même.",
    submitRequest: "Envoyer la demande",
    available: "{amount} coins disponibles",
    verifyEmail:
      "Vérifiez d'abord votre e-mail. Ouvrez la page de profil et touchez \"Envoyer le lien\" — cliquer sur le lien dans votre boîte de réception débloque les retraits.",
    coinLocked:
      "Les coins sont verrouillés dès l'envoi — ils quittent votre solde utilisable pour éviter de les dépenser sur un marché pendant l'examen. Annulez une demande en attente à tout moment pour libérer le verrou.",
    yourWithdrawals: "Vos retraits",
    noWithdrawals: "Aucun retrait pour le moment.",
    backToWallet: "← Retour au portefeuille",
    notePlaceholder: "Note (visible par l'utilisateur, facultatif)",
    approve: "Approuver",
    reject: "Rejeter",
    razorpayId: "ID de paiement Razorpay (requis)",
    markPaid: "Marquer payé",
    approvedNote: "Approuvé — traitez le paiement dans Razorpay puis marquez comme payé.",
    rejectedNote: "Rejeté — coins remboursés.",
    paidNote: "Marqué comme payé.",
    invalidState: "Déjà décidé — actualisez la page.",
    missingReference: "Collez d'abord l'ID de paiement Razorpay.",
    notFound: "Ce retrait a disparu.",
    actionFailed: "Action échouée.",
  },

  profile: {
    heading: "Profil",
    wallet: "Portefeuille",
    buyCoinButton: "Acheter des coins",
    referral: "Parrainage",
    referralSubtext:
      "Partagez votre code — quand quelqu'un s'inscrit avec, vous recevez tous les deux des coins bonus.",
    achievements: "Succès",
    walletCoins: "coins Kalki Bet",
    levelBadge: "Niv {level}",
    adminBadge: "Admin",
    streakBadge: "{days}j de série",
    xpLabel: "{xp} XP",
    xpToNext: "{xp} XP jusqu'au niveau {level}",
  },

  portfolio: {
    heading: "Portefeuille",
    subtext: "Valorisation marked-to-market de vos positions ouvertes.",
    wallet: "Portefeuille",
    atCost: "Au coût",
    valueNow: "Valeur actuelle",
    pl: "P/L",
    openPositions: "Positions ouvertes",
    noPositions: "Aucune position pour le moment. Voir les marchés →",
    recentTrades: "Échanges récents",
    noTrades: "Aucun échange pour le moment.",
  },

  watchlist: {
    heading: "Favoris",
    emptyState:
      "Vous n'avez encore favorisé aucun marché. Touchez le {icon} sur un marché pour l'ajouter.",
  },

  notifications: {
    heading: "Notifications",
    unreadCount: "{count} non lue(s).",
    allRead: "Tout lu.",
    emptyState:
      "Vous êtes à jour. Faites un échange pour recevoir des notifications.",
  },

  leaderboard: {
    heading: "Classement",
    subtext:
      "Meilleurs traders par XP total. Gagnez de l'XP en tradant — 1 XP par 20 coins dépensés.",
    emptyState: "Aucun trader pour le moment.",
  },

  achievements: {
    heading: "Succès",
    subtext:
      "Gagnez des badges en tradant, en invitant des amis et en atteignant des jalons. De l'XP à chaque déblocage.",
    unlockedCount: "{count}/{total} débloqués",
    recentlyUnlocked: "Récemment débloqués",
    allAchievements: "Tous les succès",
    unlocksAcrossUsers: "{count} déblocages sur l'ensemble des utilisateurs",
    badge: "Débloqué",
    locked: "Verrouillé",
    reward: "+{coins} 🪙 · +{xp} XP",
    earned: "{count} obtenus",
    beFirst: "Soyez le premier",
    unlockedTime: "Débloqué {time}",
    signInNote: "Connectez-vous pour commencer à gagner des succès.",
    createAccount: "Créer un compte",
  },

  kyc: {
    heading: "Vérification d'identité",
    subtext:
      "Requise pour les retraits au-dessus de la limite plateforme. Les documents envoyés sont chiffrés au repos et visibles uniquement par un seul examinateur conformité.",
    statusLabel: "Statut actuel",
    approved: "Approuvé ✓",
    approvedNote: "Limites de retrait complètes débloquées. Aucune autre action nécessaire.",
    approvedFormNote:
      "Votre identité est vérifiée. Aucun document supplémentaire nécessaire pour le moment. Si votre nom ou adresse change, contactez le support pour mettre à jour.",
    rejected: "Rejeté",
    rejectionCodeLabel: "Code : {code}",
    resubmitNote: "Vous pouvez renvoyer via le formulaire ci-dessous.",
    requestMore: "Documents supplémentaires demandés",
    pending: "En cours d'examen",
    pendingNote:
      "Le délai typique est de 1 jour ouvré. Vous recevrez une notification in-app dès que la décision sera prise.",
    pendingFormNote:
      "Vos documents sont chez l'examinateur. Vous serez notifié dès qu'une décision sera prise. Pour remplacer un document, contactez le support.",
    panLabel: "Carte PAN (recto)",
    panHint: "Photo nette de la carte. JPG/PNG/PDF jusqu'à 5 Mo.",
    aadhaarLabel: "Carte Aadhaar (recto + verso)",
    aadhaarHint:
      "Vous pouvez masquer les 8 premiers chiffres du numéro Aadhaar — les 4 derniers suffisent pour la vérification.",
    selfieLabel: "Selfie",
    selfieHint:
      "Visage clairement visible, sans lunettes de soleil ni chapeau. Utilisé pour la comparaison avec le PAN.",
    submitButton: "Envoyer pour examen",
    resubmitButton: "Renvoyer",
    uploadingButton: "Envoi…",
    securityNote:
      "Les documents sont chiffrés au repos via AES-256-GCM avec la clé de chiffrement de données enveloppée par KMS de la plateforme. Seul l'examinateur conformité assigné peut les déchiffrer, et l'accès est enregistré dans le journal d'audit admin.",
  },

  activity: {
    waitingForTrades: "En attente des échanges en direct…",
    liveActivity: "Activité en direct",
  },

  transaction: {
    signupBonus: "Bonus d'inscription",
    dailyReward: "Récompense quotidienne",
    boughtShares: "Achat de parts",
    boughtSharesBook: "Achat de parts · jambe book",
    boughtSharesAmm: "Achat de parts · jambe AMM",
    soldSharesBook: "Vente de parts · jambe book",
    soldSharesAmm: "Vente de parts · jambe AMM",
    limitOrderFilled: "Ordre limite exécuté",
    sellOrderFilled: "Ordre de vente exécuté",
    marketPayout: "Paiement de marché",
    marketRefund: "Marché annulé — remboursé",
    adminGrant: "Allocation administrateur",
    referralBonus: "Bonus de parrainage",
    achievementReward: "Récompense de succès",
    topUp: "Rechargement portefeuille",
  },
};

export default fr;

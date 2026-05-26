import type { Dictionary } from "./en";

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
    notifications: "Notifications",
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
  wallet: {
    title: "Votre portefeuille",
    balance: "Solde de coins",
    buyCoins: "Acheter des coins",
    withdraw: "Retirer",
    minWithdraw: "Min. {amount} coins",
    payWithCrypto:
      "Payez en crypto — BTC, ETH, USDT, USDC et 200+ autres. Vos coins arrivent automatiquement dès que le paiement est confirmé on-chain.",
    askAdmin: "Contactez un admin sur Secure Kalki Chat pour les paiements",
    downloadChatApp: "Télécharger Secured Chat App maintenant",
    unifiedPromise:
      "Un solde unique sur les Marchés, les Enchères et Aviator. Chaque rechargement apparaît dans votre historique.",
  },
  market: {
    yes: "OUI",
    no: "NON",
    volume: "Volume",
    ends: "Fin",
    resolved: "Résolu",
    cancelled: "Annulé",
    place_bet: "Parier",
    cash_out: "Encaisser",
    order_book: "Carnet d'ordres",
    trades: "Échanges",
    comments: "Commentaires",
  },
  auth: {
    email: "E-mail",
    username: "Nom d'utilisateur",
    password: "Mot de passe",
    signInTitle: "Connectez-vous à Kalki Exchange",
    registerTitle: "Créez votre compte Kalki",
    forgotPassword: "Mot de passe oublié ?",
    needAccount: "Pas encore de compte ?",
    haveAccount: "Vous avez déjà un compte ?",
    googleSignIn: "Se connecter avec Google",
    errors: {
      invalidCredentials: "E-mail ou mot de passe incorrect.",
      emailTaken: "Cet e-mail est déjà enregistré.",
      usernameTaken: "Ce nom d'utilisateur est déjà pris.",
      weakPassword: "Utilisez 8+ caractères avec des lettres et des chiffres.",
    },
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
  },
};

export default fr;

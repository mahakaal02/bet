/**
 * French translations — PR-AVIATOR-I18N.
 *
 * Partial dictionary: any string omitted here falls back to English
 * via the deep-merge in `../index.ts::dictionaryFor`. Aim for natural
 * French — the platform targets metropolitan French + francophone
 * markets (BE, LU). Avoid Quebec-specific phrasing.
 */

import type { Dictionary } from "./en";

const fr: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Aviator",
    tagline:
      "Jeu de pari sur courbe crash — regardez l'avion monter, retirez avant qu'il ne s'écrase.",
    description:
      "Jeu de multiplicateur en temps réel avec votre portefeuille Kalki. Pariez, regardez le multiplicateur monter, retirez avant que l'avion ne s'écrase. Équité prouvable.",
    homeTitle: "Kalki Aviator — jeu de multiplicateur",
    homeDescription:
      "Regardez l'avion monter, retirez avant le crash. Jeu de multiplicateur à équité prouvable. Un portefeuille pour Markets, Auctions et Aviator.",
    fairnessTitle: "Équité prouvable — vérifiez chaque manche",
    fairnessDescription:
      "Chaque multiplicateur dérive d'une seed du serveur engagée avant la manche. Vérifiez n'importe quelle manche dans votre navigateur.",
    profileTitle: "Votre compte",
    profileDescription:
      "Gérez votre compte Kalki, consultez votre solde et déconnectez-vous des trois jeux.",
    notificationsTitle: "Notifications",
    notificationsDescription:
      "Crashes de manche, confirmations de retrait et rotations de seed apparaissent ici.",
    withdrawTitle: "Retirer des jetons",
    withdrawDescription:
      "Retirez vos jetons Kalki vers UPI ou banque. Chaque demande est examinée avant paiement.",
    logoutTitle: "Déconnexion en cours",
    logoutDescription: "Effacement de votre session Kalki Aviator.",
  },

  nav: {
    home: "Accueil",
    profile: "Profil",
    notifications: "Notifications",
    withdraw: "Retirer",
    fairness: "Équité",
    logout: "Déconnexion",
    backToGame: "Retour au jeu",
    backToAviator: "Retour à Aviator",
    backToKalkiHub: "Retour à Kalki",
    myStats: "Mes statistiques",
  },

  switcher: {
    label: "Langue",
    chooseLanguage: "Choisissez votre langue",
  },

  common: {
    loading: "Chargement…",
    error: "Erreur",
    save: "Enregistrer",
    cancel: "Annuler",
    submit: "Envoyer",
    continue: "Continuer",
    back: "Retour",
    close: "Fermer",
    coins: "jetons",
    online: "En ligne",
  },

  game: {
    startsIn: "Démarre dans",
    almost: "Presque !",
    inFlight: "En vol",
    crashed: "Crash",
    connecting: "Connexion",
    connectingToArena: "Connexion à l'arène…",
    reconnecting: "Reconnexion…",

    bet: "Parier",
    auto: "Auto",
    betAmount: "Mise en jetons",
    autoCashoutAt: "Retrait automatique à",
    autoCashoutAria: "Multiplicateur de retrait automatique",
    placeBet: "PARIER",
    placeBetHero: "PLACER LE PARI",
    topUpToBet: "RECHARGER POUR PARIER",
    topUpToBetSub: "Ajouter des jetons",
    cashout: "RETIRER",
    busted: "PERDU",
    betPlaced: "PARI PLACÉ",
    waitingForRound: "jetons · en attente de la manche",
    waitForNextRound: "ATTENDRE LA PROCHAINE MANCHE",
    bettingOpensSoon: "Les paris ouvrent dans quelques secondes",
    cashedOut: "RETIRÉ",
    waitingForFinish: "Attente de la fin de la manche",
    maxPayoutReached: "GAIN MAXIMUM ATTEINT",
    autoCashedOut: "Retiré automatiquement",
    waiting: "EN ATTENTE…",

    minBetCoins: "Mise minimum {min} jetons",
    minBet: "Mise min. {min} jetons",
    walletHasOnly: "Portefeuille n'a que {amount}",
    walletHasTopUp: "Portefeuille a {amount} — rechargez pour parier.",
    autoCashoutMinError: "Le retrait automatique doit être au moins 1.01×",
    cashedOutAt: "Retiré à {multiplier}× · +{coins}",
    wallet: "Portefeuille",
    maxChip: "Max",

    recent: "Récent",
    waitingForFirstRound: "En attente de la première manche…",
    roundHistory: "Historique des Manches",
    showFullHistory: "Voir l'historique complet",
    closeRoundHistory: "Fermer l'historique",
    noRoundsYet: "Pas encore de manches. Le premier crash apparaîtra ici.",
    roundLabel: "Manche #{n} — {tier}",

    players: "Joueurs",
    betVolume: "Vol. paris",
    paidOut: "Payé",
    noBetsYet: "Pas encore de paris pour cette manche.",
    waitingForNextRound: "En attente de la prochaine manche…",
    cashedOutCount: "Ont retiré · {count}",
    autoCashoutTarget: "Cible de retrait automatique",
    autoLabel: "auto",
    recentWinners: "Gagnants récents",
    noCashoutsYet: "Aucun retrait dans cette session.",

    liveChat: "Chat en direct",
    chatPlaceholder: "Dis quelque chose…",
    chatBeFirst: "Sois le premier à parler.",
    chatYou: "toi",
    chatSend: "Envoyer",
    chatSendFailed: "envoi échoué",
  },

  wallet: {
    balance: "Solde du portefeuille",
    topUp: "+ Recharger",
    encash: "Retirer",
    topUpTitle: "Rechargez votre portefeuille",
    manageWallet: "Gérer le portefeuille",
    encashUnlocks: "Le retrait débloque à {min} — il reste {remaining}.",
    encashTooltipUnlocked: "Retirer vers votre banque / UPI",
    encashTooltipLocked: "Atteignez {min} pour activer les retraits",
    minWithdraw: "min. {amount} jetons",
    unifiedWallet: "Portefeuille unifié",
    unifiedNote: "Même solde sur Auctions, Aviator et Kalki Exchange.",
  },

  fairness: {
    title: "Équité prouvable",
    description:
      "Chaque multiplicateur de crash d'Aviator dérive d'une seed du serveur engagée avant la manche (son hash est public) et d'une seed client déterministe. La seed est révélée à la rotation du lot — n'importe qui peut alors recalculer chaque multiplicateur et vérifier que le serveur n'a pas triché. Cliquez sur Vérifier sur n'importe quelle manche ci-dessous pour la recalculer dans votre navigateur.",
    activeSeed: "Seed active",
    noActiveSeed: "Aucune seed active.",
    seedHidden:
      "La serverSeed elle-même reste cachée jusqu'à la rotation — c'est l'engagement.",
    recentRounds: "Manches récentes",
    columnRound: "Manche",
    columnCrash: "Crash",
    columnNonce: "Nonce",
    columnSeedStatus: "Statut de la seed",
    seedRevealed: "révélée (lot tourné)",
    seedVerifiable: "vérifiable",
    verify: "vérifier",
    verifying: "vérification…",
    revealedBatches: "Lots de seed révélés",
    noBatchesYet:
      "Aucun lot tourné pour le moment. Quand un admin fera tourner la seed active (ou que le plafond d'auto-rotation se déclenche), la seed apparaîtra ici avec la plage de manches couverte.",
    rangeRounds: "manches #{from}–#{to}",
    howItWorks: "Comment fonctionne la vérification",
    howItWorksBody:
      "Pour chaque manche, on calcule HMAC-SHA256(serverSeed, \"{clientSeed}:{nonce}\"). On prend les 13 premiers caractères hex comme entier e ; le multiplicateur de crash est floor(100 · 2^52 / (2^52 − e)) / 100, à deux décimales — sauf 1 manche sur 33 (≈3 % d'avantage maison) qui crash à 1.00. Le bouton vérifier fait cela dans votre navigateur via la Web Crypto API.",
  },

  notifications: {
    heading: "Notifications",
    subtext:
      "Crashes de manche, confirmations de retrait et rotations de seed apparaîtront ici.",
    emptyState: "Tout est à jour.",
  },

  profile: {
    backToAviator: "← Retour à Aviator",
    account: "Compte",
    unifiedWallet: "Portefeuille unifié",
    unifiedNote: "Même solde sur Auctions, Aviator et Kalki Exchange.",
    signOut: "Déconnexion",
    signOutAllDescription:
      "Vous déconnecte des trois jeux Kalki et efface votre session sur cet appareil.",
    signOutButton: "Se déconnecter de tous les jeux",
    signingOut: "Déconnexion…",
    defaultEmail: "Compte WhatsApp / e-mail",
  },

  withdraw: {
    opening: "Ouverture du retrait…",
    redirecting: "Redirection vers le portefeuille Kalki pour envoyer votre demande.",
  },

  logout: {
    signingOut: "Déconnexion en cours…",
    bridging: "Connexion de votre session Kalki Aviator — cela n'arrive qu'une fois.",
  },

  stats: {
    title: "Mes Statistiques",
    closeAria: "Fermer les statistiques",
    rangeDay: "Jour",
    rangeWeek: "Semaine",
    rangeMonth: "Mois",
    rangeAll: "Tout",
    biggestX: "Plus gros X",
    biggestWin: "Plus gros gain",
    totalBets: "Total des paris",
    winRate: "Taux de victoire",
    wagered: "Misé",
    netPL: "G/P net",
    winsLosses: "{wins} gagnés · {losses} perdus",
    loading: "Chargement des statistiques…",
    loadFailed: "Impossible de charger.",
    footnoteDay: "Dernières 24 heures · échantillon de vos 200 derniers paris",
    footnoteWeek: "7 derniers jours · échantillon de vos 200 derniers paris",
    footnoteMonth: "30 derniers jours · échantillon de vos 200 derniers paris",
    footnoteAll: "Depuis la création du compte · échantillon de vos 200 derniers paris",
  },

  errors: {
    genericNetwork: "Erreur réseau. Réessayez.",
    signedOut: "Veuillez vous connecter.",
    insufficientBalance: "Solde insuffisant dans votre portefeuille.",
    couldntLoad: "Impossible de charger.",
  },
};

export default fr;

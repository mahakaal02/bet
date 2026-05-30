import type { Dictionary } from "./en";

/**
 * French (fr-FR baseline, intelligible across all francophone
 * markets — FR/BE/LU/CA-QC). Strings missing fall back to English
 * via the deep-fallback walker in `../index.ts::t`.
 *
 * Translation notes (PR-AUCTIONS-I18N):
 *   - "jetons" for demo coins — clearer than "pièces" in iGaming
 *     contexts (matches the convention used across kalki.bet).
 *   - "enchère(s)" for auction(s); "miser / mise" for bid (standard
 *     French auction vocabulary).
 *   - "retirer" / "recharger" for withdraw / top-up.
 */
const fr: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Enchères",
    tagline:
      "Enchères à la plus petite mise unique avec des jetons Kalki — le même portefeuille que les marchés de prédiction et Aviator.",
    description:
      "Misez sur de vrais produits avec des jetons Kalki. La plus petite mise unique gagne. Un portefeuille pour Enchères, Aviator et Exchange.",
    homeTitle: "Kalki — choisissez un jeu, un seul portefeuille",
    homeDescription:
      "Trois jeux, un seul portefeuille. Enchères, Aviator et Kalki Exchange. Choisissez où dépenser vos jetons.",
    auctionsTitle: "Enchères en direct — la plus petite mise unique gagne",
    auctionsDescription:
      "Parcourez les enchères en direct, à venir et terminées. Chaque mise coûte des jetons et la plus petite mise unique remporte un vrai produit.",
    auctionDetailTitle: "Détail de l'enchère",
    auctionDetailDescription:
      "Placez votre mise. La plus petite mise unique gagne — voyez le statut et le temps restant.",
    profileTitle: "Votre profil",
    profileDescription:
      "Gérez votre compte, adresses, KYC, sécurité et parrainages sur l'écosystème Kalki.",
    notificationsTitle: "Notifications",
    notificationsDescription:
      "Mises à jour de commande, statut des mises, réponses du support et récompenses.",
    loginTitle: "Connexion à Kalki",
    loginDescription:
      "Connectez-vous pour miser sur les enchères, gérer votre portefeuille et suivre vos articles favoris.",
    forgotTitle: "Réinitialiser votre mot de passe",
    forgotDescription:
      "Mot de passe oublié ? Entrez votre e-mail pour recevoir un lien.",
    resetTitle: "Choisir un nouveau mot de passe",
    resetDescription:
      "Définissez un nouveau mot de passe pour votre compte Kalki.",
    watchlistTitle: "Favoris",
    watchlistDescription:
      "Vos enchères favorites — accès rapide aux articles que vous suivez.",
    ordersTitle: "Mes commandes",
    ordersDescription:
      "Articles que vous avez gagnés. Suivez l'expédition, ouvrez un litige, définissez une adresse.",
    kycTitle: "Vérification d'identité",
    kycDescription:
      "Vérifiez votre identité pour débloquer des limites de retrait plus élevées. Documents chiffrés au repos.",
    addressesTitle: "Adresses de livraison",
    addressesDescription:
      "Où les gains sont expédiés — jusqu'à 10 adresses, une par défaut.",
    twofaTitle: "Authentification à deux facteurs",
    twofaDescription:
      "Ajoutez un code d'authentificateur à la connexion pour plus de sécurité.",
    referralsTitle: "Parrainer un ami",
    referralsDescription:
      "Partagez votre code — vous gagnez tous deux des jetons bonus à l'inscription.",
    supportTitle: "Tickets de support",
    supportDescription:
      "Bloqué sur quelque chose ? Dites-le nous — nous répondons en quelques heures.",
    dailyTitle: "Récompense quotidienne",
    dailyDescription:
      "Récompense plus grande chaque jour — bonus aux jours 7, 14 et 30.",
    rgTitle: "Jeu responsable",
    rgDescription:
      "Définissez des limites, prenez une pause ou auto-excluez-vous. Aide au 1800-599-0019.",
    deleteTitle: "Fermer le compte et exporter les données",
    deleteDescription:
      "Période de réflexion de 30 jours · téléchargez vos données quand vous voulez.",
    emailTitle: "Changer l'e-mail",
    emailDescription:
      "L'e-mail actuel et le nouveau doivent confirmer avant l'application.",
  },

  nav: {
    home: "Accueil",
    auctions: "Enchères",
    games: "Jeux",
    profile: "Profil",
    notifications: "Notifications",
    watchlist: "Favoris",
    signIn: "Se connecter",
    signOut: "Se déconnecter",
    register: "S'inscrire",
  },

  hub: {
    pickProduct:
      "Choisissez un produit pour commencer. Vos jetons vous suivent — un seul portefeuille pour les trois.",
    pickProductAdmin:
      "Choisissez un produit à administrer. Chaque tuile ouvre sa console admin.",
    greeting: "Salut, {handle}",
    adminBadge: "Admin",
    auctionsTitle: "Enchères en direct",
    auctionsTagline:
      "La plus petite mise unique gagne. Chaque mise coûte des jetons.",
    auctionsAdminTagline:
      "Gérez les enchères en direct, clôturez les manches, inspectez les mises.",
    aviatorTitle: "Aviator",
    aviatorTagline: "Encaissez avant que le multiplicateur ne crashe.",
    aviatorAdminTagline:
      "Analytics, journal des manches, seeds, modération du chat.",
    exchangeTitle: "Kalki Exchange",
    exchangeTagline: "Tradez des parts OUI/NON sur des marchés de prédiction.",
    exchangeAdminTagline:
      "Marchés, utilisateurs, retraits, modération des commentaires.",
    open: "Ouvrir →",
    coinsInWallet: "{coins} jetons dans votre portefeuille.",
    topUpWallet: "Recharger le portefeuille →",
  },

  common: {
    loading: "Chargement…",
    error: "Une erreur est survenue.",
    save: "Enregistrer",
    cancel: "Annuler",
    submit: "Envoyer",
    continue: "Continuer",
    back: "← Retour",
    next: "Suivant",
    close: "Fermer",
    edit: "Modifier",
    delete: "Supprimer",
    confirm: "Confirmer",
    coins: "jetons",
    sending: "Envoi…",
    saving: "Enregistrement…",
    submitting: "Envoi…",
    retry: "Réessayer",
  },

  switcher: {
    label: "Langue",
    chooseLanguage: "Choisissez votre langue",
  },

  auth: {
    emailLabel: "E-mail",
    passwordLabel: "Mot de passe",
    usernameLabel: "Nom d'utilisateur",
    emailPlaceholder: "vous@exemple.com",

    signInTitle: "Connexion à Kalki",
    signInButton: "Se connecter",
    signingInButton: "Connexion…",
    forgotPasswordLink: "Mot de passe oublié ?",
    needAccount: "Pas encore inscrit ?",
    registerLink: "Créer un compte",
    invalidCredentials: "E-mail ou mot de passe invalide.",
    telegramContinue: "Continuer avec Telegram",

    registerTitle: "Créez votre compte Kalki",
    createAccountButton: "Créer mon compte",
    creatingAccountButton: "Création…",
    alreadyRegistered: "Déjà inscrit ?",
    signInLink: "Se connecter",

    forgotHeading: "Réinitialiser le mot de passe",
    forgotSubtext:
      "Nous vous enverrons un lien unique pour définir un nouveau mot de passe. Le lien expire dans 30 minutes.",
    forgotSendButton: "Envoyer le lien",
    forgotSendingButton: "Envoi…",
    forgotSuccess:
      "Si {email} est enregistré, vous recevrez un lien dans un instant.",
    forgotRememberedIt: "Vous vous en souvenez ?",
    forgotBackToSignIn: "Retour à la connexion",

    resetHeading: "Choisir un nouveau mot de passe",
    newPasswordLabel: "Nouveau mot de passe",
    confirmPasswordLabel: "Confirmer le mot de passe",
    updatePasswordButton: "Mettre à jour",
    updatingPasswordButton: "Mise à jour…",
    invalidOrExpiredLink: "Ce lien est invalide ou a expiré.",
    passwordUpdatedSignIn:
      "Mot de passe mis à jour. Veuillez vous reconnecter.",
    requestNewLink: "Demander un nouveau lien →",

    twofaChallenge: "Code à deux facteurs",
    twofaPlaceholder: "Code à 6 chiffres",
    twofaSubmit: "Vérifier",
    twofaBackupCode: "Utiliser un code de secours",
    twofaTrustDevice: "Faire confiance à cet appareil pendant 30 jours",
    twofaInvalid: "Ce code n'a pas fonctionné — réessayez.",

    signOutButton: "Se déconnecter des trois jeux",
    signOutDescription:
      "Vous déconnecte des trois jeux Kalki et efface votre session sur cet appareil.",

    rateLimited: "Trop de tentatives — patientez une minute.",
    tooManyRequests: "Trop de requêtes — patientez un peu.",
    weakPassword: "Utilisez 8+ caractères avec lettres et chiffres.",
    emailTaken: "Cet e-mail est déjà inscrit.",
    genericError: "Une erreur est survenue. Réessayez.",
  },

  auction: {
    heading: "Enchères",
    subtext:
      "Enchères à la plus petite mise unique. Parcourez ci-dessous — connectez-vous pour miser et suivre votre position en direct.",
    tabLive: "En direct",
    tabUpcoming: "À venir",
    tabClosed: "Terminées",
    statusLive: "En direct",
    statusUpcoming: "À venir",
    statusEnded: "Terminée",
    emptyLive: "Rien en direct pour l'instant. Voyez l'onglet À venir.",
    emptyUpcoming: "Aucune enchère programmée.",
    emptyEnded:
      "Pas encore d'enchères terminées — les récentes apparaîtront ici.",
    fetchError: "Impossible de charger les enchères : {error}.",
    retailPrice: "Prix de détail",
    coinsPerBid: "Jetons par mise",
    coinsPerBidValue: "{n} jeton",
    coinsPerBidValuePlural: "{n} jetons",
    timeStartsSoon: "commence bientôt",
    timeStartsIn: "commence {time}",
    timeEndingNow: "se termine…",
    timeEndsIn: "termine {time}",
    timeEndedAt: "terminée {time}",
    timeEnded: "terminée",
    winnerNoneDeclared: "Aucun gagnant déclaré.",
    winnerWonAt: "a gagné à",
    backAll: "← Toutes les enchères",
    winner: "Gagnant",
    placeBidHeading: "Placer une mise",
    howItWorksHeading: "Comment ça marche",
    howItWorks1:
      "Chaque mise coûte {coins} jeton{s} de votre portefeuille.",
    howItWorks2: "Choisissez un montant entre 0,01 € et le prix de détail.",
    howItWorks3:
      "Quand le minuteur tombe à zéro, la plus petite mise unique gagne.",
    aboutThisItem: "À propos de cet article",
    bidNow: "Placer une mise",
    bidAmountLabel: "Montant de la mise",
    bidPlacing: "Envoi…",
    bidSuccess: "Mise placée.",
    bidErrorInsufficientCoins:
      "Pas assez de jetons. Rechargez pour continuer.",
    bidErrorAuctionClosed: "Cette enchère n'accepte plus de mises.",
    bidErrorRateLimited:
      "Doucement — patientez avant de miser à nouveau.",
    bidErrorInvalidAmount:
      "Choisissez un montant entre 0,01 € et le prix de détail.",
    bidErrorGeneric: "Impossible d'enregistrer la mise.",
    bidErrorSignedOut: "Connectez-vous pour miser.",
    bidSignInPrompt: "Connectez-vous pour placer une mise.",
    watch: "Suivre",
    watching: "Suivi",
    watchToggleError: "Impossible de mettre à jour la liste.",
  },

  profile: {
    heading: "Profil",
    backToHub: "← Retour au hub",
    noEmail: "aucun e-mail enregistré",
    adminBadge: "admin",
    sectionAccount: "Compte",
    sectionProfile: "Profil",
    sectionSecurity: "Sécurité",
    sectionRG: "Jeu responsable",
    sectionDaily: "Récompense quotidienne",
    sectionEmail: "Compte",
    sectionShipping: "Livraison",
    sectionIdentity: "Identité",
    sectionReferrals: "Parrainer un ami",
    sectionOrders: "Commandes",
    sectionHelp: "Aide",
    sectionDanger: "Zone de danger",
    sectionSignOut: "Se déconnecter",
    unifiedWallet: "Portefeuille unifié",
    coinsValue: "{coins} jetons",
    unifiedNote: "Même solde sur Enchères, Aviator et Kalki Exchange.",
    displayNameTitle: "Nom et avatar",
    displayNameSubtext:
      "Votre visage public sur Kalki — modifiable tous les 30 jours",
    twofaTitle: "Authentification à deux facteurs",
    twofaSubtext: "Ajoutez un code d'authentificateur à la connexion",
    rgTitle: "Limites, pause, auto-exclusion",
    rgSubtext:
      "Définissez des limites ou prenez une pause — aide au 1800-599-0019",
    dailyTitle: "Série quotidienne",
    dailySubtext:
      "Récompense plus grande chaque jour — bonus aux jours 7, 14 et 30",
    emailTitle: "Changer l'e-mail",
    emailSubtext:
      "L'e-mail actuel et le nouveau doivent confirmer avant l'application",
    addressesTitle: "Adresses de livraison",
    addressesSubtext:
      "Où les gains sont expédiés — jusqu'à 10, une par défaut",
    kycTitle: "Vérification KYC",
    kycSubtext:
      "Vérifiez votre identité pour débloquer des limites plus élevées",
    referralsTitle: "Partagez votre code",
    referralsSubtext:
      "Gagnez des jetons quand un ami s'inscrit et recharge",
    ordersTitle: "Suivre les expéditions",
    ordersSubtext:
      "Articles gagnés — choisissez une adresse, suivez la livraison",
    supportTitle: "Tickets de support",
    supportSubtext:
      "Bloqué ? Dites-le nous — nous répondons rapidement",
    deleteTitle: "Fermer le compte et exporter les données",
    deleteSubtext:
      "30 jours de réflexion · téléchargez vos données quand vous voulez",
  },

  me: {
    profileHeading: "Profil",
    profileSubtext:
      "Votre @{handle} est votre identifiant unique (visible dans les historiques de mises et reçus). Nom et avatar sont ce que les autres voient.",
    accountLink: "← Compte",

    dailyHeading: "Récompense quotidienne",
    dailySubtext:
      "Connectez-vous chaque jour pour faire grandir votre série. Bonus aux jours 7, 14 et 30.",
    dailyClaim: "Récupérer la récompense du jour",
    dailyClaimed: "Récupérée",
    dailyStreak: "Série de {days} jours",

    twofaHeading: "Authentification à deux facteurs",
    twofaSubtext:
      "Ajoutez un code d'authentificateur. Google Authenticator, 1Password, Authy etc.",
    twofaEnable: "Activer 2FA",
    twofaDisable: "Désactiver 2FA",
    twofaEnabled: "2FA activée",

    addressesHeading: "Adresses de livraison",
    addressesSubtext:
      "Jusqu'à 10 adresses. Une par défaut — utilisée à chaque gain sauf si vous changez.",
    addressesAdd: "Ajouter une adresse",
    addressesEmpty:
      "Aucune adresse. Ajoutez-en une avant de gagner votre première enchère.",
    addressesMakeDefault: "Définir par défaut",
    addressesDefault: "Par défaut",
    addressesDelete: "Supprimer",

    kycHeading: "Vérification d'identité",
    kycSubtext:
      "Nécessaire pour débloquer des limites de retrait plus élevées. Documents chiffrés.",
    kycSubmit: "Envoyer pour vérification",
    kycPending: "En cours d'examen",
    kycApproved: "Approuvé",
    kycRejected: "Rejeté — renvoyer ci-dessous",

    ordersHeading: "Mes commandes",
    ordersSubtext:
      "Articles gagnés. Suivez l'expédition, ouvrez un litige, définissez une adresse.",
    ordersEmpty:
      "Aucune commande. Gagnez une enchère et elle apparaîtra ici.",
    ordersOpenAddress: "Choisir une adresse",
    ordersAwaiting: "En attente d'expédition",
    ordersInTransit: "En transit",
    ordersDelivered: "Livré",
    ordersDisputed: "En litige",
    ordersCancelled: "Annulé",
    ordersTrack: "Suivre →",
    ordersOpenDispute: "Ouvrir un litige",

    referralsHeading: "Parrainer un ami",
    referralsSubtext:
      "Partagez votre code. Quand un ami s'inscrit et fait sa première recharge, vous gagnez tous deux des bonus.",
    referralsCodeLabel: "Votre code",
    referralsCopy: "Copier",
    referralsCopied: "Copié",
    referralsClaim: "Récupérer le bonus",

    supportHeading: "Tickets de support",
    supportSubtext:
      "Bloqué sur quelque chose ? Dites-le nous — nous répondons en quelques heures.",
    supportNew: "Nouveau ticket",
    supportEmpty: "Aucun ticket. Ouvrez-en un et nous répondrons.",
    supportOpen: "Ouvert",
    supportClosed: "Fermé",
    supportPlaceholder: "Décrivez ce qui s'est passé…",
    supportSend: "Envoyer",

    watchlistHeading: "Favoris",
    watchlistSubtext:
      "Enchères suivies. Nous vous avertirons avant la clôture de chacune.",
    watchlistEmpty:
      "Vous n'avez encore suivi aucune enchère. Touchez l'étoile pour ajouter.",

    emailHeading: "Changer l'e-mail",
    emailSubtext:
      "L'e-mail actuel et le nouveau doivent confirmer avant l'application. Nous enverrons un lien à chacun.",
    emailNewLabel: "Nouvel e-mail",
    emailRequestChange: "Demander le changement",
    emailRequestPending:
      "En attente — consultez les deux boîtes pour le lien de confirmation.",
    emailCancelChange: "Annuler la demande en cours",

    deleteHeading: "Fermer le compte",
    deleteSubtext:
      "Ferme votre compte Kalki sur les trois jeux. Réflexion de 30 jours — reconnectez-vous avant pour annuler.",
    deleteConfirmLabel: "Tapez DELETE pour confirmer",
    deleteButton: "Fermer mon compte",
    dataExport: "Télécharger mes données",
    dataExportSubtext:
      "Export GDPR de votre compte, historique du portefeuille et mises en JSON.",

    rgHeading: "Jeu responsable",
    rgSubtext:
      "Définissez des limites. Les baisser est immédiat ; les augmenter nécessite 24 h d'attente.",
    rgCooldown: "Prendre une pause",
    rgSelfExclude: "Auto-exclure",
    rgWeeklyLimit: "Limite hebdomadaire",
    rgDailyLimit: "Limite quotidienne",
    rgSessionLimit: "Limite par session",
    rgHelpline:
      "Si vous avez besoin d'aide, appelez le 1800-599-0019 (KIRAN — ligne santé mentale, Inde).",
  },

  notifications: {
    heading: "Notifications",
    subtext:
      "Mises à jour de commande, statut des mises, réponses du support et récompenses.",
    unreadCount: "{count} non lues",
    allRead: "Tout lu.",
    markAllRead: "Tout marquer comme lu",
    emptyState:
      "Vous êtes à jour. Placez une mise pour commencer à recevoir des notifications.",
    preferencesHeading: "Préférences de notification",
    preferencesEmail: "Recevoir des e-mails sur",
    preferencesPush: "Notifications push",
  },

  share: {
    button: "Partager",
    copied: "Copié",
    shared: "Partagé.",
    linkCopied: "Lien copié dans le presse-papiers.",
    couldntCopy:
      "Impossible de copier — votre navigateur a bloqué l'accès au presse-papiers.",
    ariaLabel: "Partager cette enchère",
  },

  errors: {
    genericNetwork: "Erreur réseau. Réessayez.",
    signedOut: "Veuillez vous connecter.",
    notFound: "Page introuvable",
    notFoundDescription:
      "La page que vous cherchez n'existe pas ou a été déplacée.",
    backHome: "Retour à l'accueil",
    generic: "Une erreur est survenue.",
    unauthorized: "Veuillez vous connecter.",
    forbidden: "Vous n'avez pas accès à cette page.",
    serverError: "Erreur serveur. Réessayez dans un instant.",
  },

  toast: {
    saved: "Enregistré.",
    copied: "Copié.",
    error: "Une erreur est survenue.",
    submitted: "Envoyé.",
  },

  topup: {
    label: "Recharger",
    coinsLabel: "jetons",
    open: "Ouvrir le portefeuille",
  },
};

export default fr;

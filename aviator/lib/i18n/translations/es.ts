/**
 * Spanish translations — PR-AVIATOR-I18N.
 *
 * Partial dictionary: any string omitted here falls back to English
 * via the deep-merge in `../index.ts::dictionaryFor`. Aim for natural
 * Latin-American Spanish — the platform's largest Spanish-speaking
 * market is LATAM, not Spain.
 */

import type { Dictionary } from "./en";

const es: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Aviator",
    tagline:
      "Juego de apuesta de curva crash — mira al avión subir, retira antes de que caiga.",
    description:
      "Juego de multiplicador en tiempo real con tu billetera Kalki. Apuesta, mira el multiplicador subir, retira antes de que el avión caiga. Demostrablemente justo.",
    homeTitle: "Kalki Aviator — juego de multiplicador",
    homeDescription:
      "Mira al avión subir, retira antes de que caiga. Juego de multiplicador demostrablemente justo. Una sola billetera para Markets, Auctions y Aviator.",
    fairnessTitle: "Demostrablemente justo — verifica cada ronda",
    fairnessDescription:
      "Cada multiplicador se deriva de una semilla del servidor comprometida antes de la ronda. Verifica cualquier ronda directamente en tu navegador.",
    profileTitle: "Tu cuenta",
    profileDescription:
      "Gestiona tu cuenta Kalki, mira tu saldo y cierra sesión en los tres juegos.",
    notificationsTitle: "Notificaciones",
    notificationsDescription:
      "Crashes de ronda, confirmaciones de retiro y rotaciones de semilla aparecen aquí.",
    withdrawTitle: "Retirar monedas",
    withdrawDescription:
      "Retira tus monedas Kalki a UPI o banco. Cada solicitud se revisa antes del pago.",
    logoutTitle: "Cerrando tu sesión",
    logoutDescription: "Borrando tu sesión de Kalki Aviator.",
  },

  nav: {
    home: "Inicio",
    profile: "Perfil",
    notifications: "Notificaciones",
    withdraw: "Retirar",
    fairness: "Transparencia",
    logout: "Cerrar sesión",
    backToGame: "Volver al juego",
    backToAviator: "Volver al Aviator",
    backToKalkiHub: "Volver a Kalki",
    myStats: "Mis estadísticas",
  },

  switcher: {
    label: "Idioma",
    chooseLanguage: "Elige tu idioma",
  },

  common: {
    loading: "Cargando…",
    error: "Error",
    save: "Guardar",
    cancel: "Cancelar",
    submit: "Enviar",
    continue: "Continuar",
    back: "Atrás",
    close: "Cerrar",
    coins: "monedas",
    online: "En línea",
  },

  game: {
    startsIn: "Empieza en",
    almost: "¡Casi!",
    inFlight: "En vuelo",
    crashed: "Cayó",
    connecting: "Conectando",
    connectingToArena: "Conectando a la arena…",
    reconnecting: "Reconectando…",

    bet: "Apostar",
    auto: "Auto",
    betAmount: "Monto de apuesta en monedas",
    autoCashoutAt: "Retiro automático en",
    autoCashoutAria: "Multiplicador de retiro automático",
    placeBet: "APOSTAR",
    placeBetHero: "HACER APUESTA",
    topUpToBet: "RECARGAR PARA APOSTAR",
    topUpToBetSub: "Agregar monedas",
    cashout: "RETIRAR",
    busted: "PERDIDO",
    betPlaced: "APUESTA HECHA",
    waitingForRound: "monedas · esperando ronda",
    waitForNextRound: "ESPERA LA PRÓXIMA RONDA",
    bettingOpensSoon: "Las apuestas abren en unos segundos",
    cashedOut: "RETIRADO",
    waitingForFinish: "Esperando a que termine la ronda",
    maxPayoutReached: "PAGO MÁXIMO ALCANZADO",
    autoCashedOut: "Retirado automáticamente",
    waiting: "ESPERANDO…",

    minBetCoins: "Apuesta mínima es {min} monedas",
    minBet: "Apuesta mín. {min} monedas",
    walletHasOnly: "Billetera solo tiene {amount}",
    walletHasTopUp: "Billetera tiene {amount} — recarga para apostar.",
    autoCashoutMinError: "Retiro automático debe ser al menos 1.01×",
    cashedOutAt: "Retirado en {multiplier}× · +{coins}",
    wallet: "Billetera",
    maxChip: "Máx",

    recent: "Recientes",
    waitingForFirstRound: "Esperando primera ronda…",
    roundHistory: "Historial de Rondas",
    showFullHistory: "Mostrar historial completo",
    closeRoundHistory: "Cerrar historial",
    noRoundsYet: "Sin rondas aún. El primer crash aparecerá aquí.",
    roundLabel: "Ronda #{n} — {tier}",

    players: "Jugadores",
    betVolume: "Vol. apuestas",
    paidOut: "Pagado",
    noBetsYet: "Sin apuestas en esta ronda.",
    waitingForNextRound: "Esperando próxima ronda…",
    cashedOutCount: "Retiraron · {count}",
    autoCashoutTarget: "Objetivo de retiro automático",
    autoLabel: "auto",
    recentWinners: "Ganadores recientes",
    noCashoutsYet: "Sin retiros en esta sesión.",

    liveChat: "Chat en vivo",
    chatPlaceholder: "Di algo…",
    chatBeFirst: "Sé el primero en decir algo.",
    chatYou: "tú",
    chatSend: "Enviar",
    chatSendFailed: "envío falló",
  },

  wallet: {
    balance: "Saldo de billetera",
    topUp: "+ Recargar",
    encash: "Retirar",
    topUpTitle: "Recarga tu billetera",
    manageWallet: "Gestionar billetera",
    encashUnlocks: "Retiro se habilita en {min} — faltan {remaining}.",
    encashTooltipUnlocked: "Retirar a tu banco / UPI",
    encashTooltipLocked: "Alcanza {min} para habilitar retiros",
    minWithdraw: "mín. {amount} monedas",
    unifiedWallet: "Billetera unificada",
    unifiedNote: "Mismo saldo en Auctions, Aviator y Kalki Exchange.",
  },

  fairness: {
    title: "Demostrablemente justo",
    description:
      "Cada multiplicador de crash del Aviator se deriva de una semilla del servidor comprometida antes de la ronda (su hash es público) y una semilla cliente determinística. La semilla se revela cuando el lote rota — en ese momento cualquiera puede recalcular cada multiplicador y verificar que el servidor no hizo trampa. Haz clic en Verificar en cualquier ronda abajo para recomputarla en tu navegador.",
    activeSeed: "Semilla activa",
    noActiveSeed: "Sin semilla activa.",
    seedHidden:
      "La serverSeed en sí queda oculta hasta la rotación — ese es el compromiso.",
    recentRounds: "Rondas recientes",
    columnRound: "Ronda",
    columnCrash: "Crash",
    columnNonce: "Nonce",
    columnSeedStatus: "Estado de la semilla",
    seedRevealed: "revelada (lote rotado)",
    seedVerifiable: "verificable",
    verify: "verificar",
    verifying: "verificando…",
    revealedBatches: "Lotes de semilla revelados",
    noBatchesYet:
      "Ningún lote rotado aún. Cuando un admin rote la semilla activa (o se dispare el techo de auto-rotación), la semilla aparecerá aquí con el rango de rondas que cubrió.",
    rangeRounds: "rondas #{from}–#{to}",
    howItWorks: "Cómo funciona la verificación",
    howItWorksBody:
      "Para cada ronda calculamos HMAC-SHA256(serverSeed, \"{clientSeed}:{nonce}\"). Tomamos los primeros 13 caracteres hex como entero e; el multiplicador de crash es floor(100 · 2^52 / (2^52 − e)) / 100, con dos decimales — excepto 1 de cada 33 rondas (≈3% de ventaja de la casa) que tienen crash instantáneo en 1.00. El botón verificar hace esto en tu navegador usando la Web Crypto API.",
  },

  notifications: {
    heading: "Notificaciones",
    subtext:
      "Crashes de ronda, confirmaciones de retiro y rotaciones de semilla aparecerán aquí.",
    emptyState: "Estás al día.",
  },

  profile: {
    backToAviator: "← Volver al Aviator",
    account: "Cuenta",
    unifiedWallet: "Billetera unificada",
    unifiedNote: "Mismo saldo en Auctions, Aviator y Kalki Exchange.",
    signOut: "Cerrar sesión",
    signOutAllDescription:
      "Cierra tu sesión en los tres juegos Kalki y borra los datos de este dispositivo.",
    signOutButton: "Cerrar sesión en todos los juegos",
    signingOut: "Cerrando…",
    defaultEmail: "Cuenta de WhatsApp / correo",
  },

  withdraw: {
    opening: "Abriendo retiro…",
    redirecting: "Redirigiendo a la billetera Kalki para enviar tu solicitud.",
  },

  logout: {
    signingOut: "Cerrando tu sesión…",
    bridging: "Conectando tu sesión Kalki Aviator — esto solo pasa una vez.",
  },

  stats: {
    title: "Mis Estadísticas",
    closeAria: "Cerrar estadísticas",
    rangeDay: "Día",
    rangeWeek: "Semana",
    rangeMonth: "Mes",
    rangeAll: "Todo",
    biggestX: "Mayor X",
    biggestWin: "Mayor Ganancia",
    totalBets: "Total de Apuestas",
    winRate: "Tasa de Victoria",
    wagered: "Apostado",
    netPL: "G/P Neto",
    winsLosses: "{wins} ganadas · {losses} perdidas",
    loading: "Cargando estadísticas…",
    loadFailed: "No se pudieron cargar.",
    footnoteDay: "Últimas 24 horas · muestra de tus 200 apuestas más recientes",
    footnoteWeek: "Últimos 7 días · muestra de tus 200 apuestas más recientes",
    footnoteMonth: "Últimos 30 días · muestra de tus 200 apuestas más recientes",
    footnoteAll: "Desde la creación de la cuenta · muestra de tus 200 apuestas más recientes",
  },

  errors: {
    genericNetwork: "Error de red. Intenta de nuevo.",
    signedOut: "Por favor inicia sesión.",
    insufficientBalance: "Saldo insuficiente en tu billetera.",
    couldntLoad: "No se pudo cargar.",
  },
};

export default es;

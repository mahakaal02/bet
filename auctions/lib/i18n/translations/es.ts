import type { Dictionary } from "./en";

/**
 * Spanish (es-ES baseline, broadly intelligible across LATAM).
 * Strings missing from this dictionary fall back to the English copy
 * in `./en.ts` via the deep-fallback walker in `../index.ts::t`.
 *
 * Translation notes (PR-AUCTIONS-I18N):
 *   - "monedas" for demo coins.
 *   - "subasta(s)" for auction(s); "puja" for bid (standard across
 *     European and LATAM Spanish auction sites).
 *   - "retirar" / "recargar" for withdraw / top-up.
 */
const es: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Subastas",
    tagline:
      "Subastas de menor puja única con monedas Kalki — la misma cartera que potencia los mercados de predicción y Aviator.",
    description:
      "Puja por productos reales con monedas Kalki. La puja única más baja gana. Una cartera para Subastas, Aviator y Exchange.",
    homeTitle: "Kalki — elige un juego, una cartera",
    homeDescription:
      "Tres juegos, una cartera. Subastas, Aviator y Kalki Exchange. Elige dónde gastar tus monedas.",
    auctionsTitle: "Subastas en vivo — gana la puja única más baja",
    auctionsDescription:
      "Mira las subastas en vivo, próximas y cerradas. Cada puja cuesta monedas y la puja única más baja se lleva un producto real.",
    auctionDetailTitle: "Detalle de subasta",
    auctionDetailDescription:
      "Haz tu puja. La puja única más baja gana — mira el estado en vivo y el tiempo restante.",
    profileTitle: "Tu perfil",
    profileDescription:
      "Gestiona tu cuenta, direcciones, KYC, seguridad y referidos en todo el ecosistema Kalki.",
    notificationsTitle: "Notificaciones",
    notificationsDescription:
      "Actualizaciones de pedido, estado de pujas, respuestas de soporte y recompensas.",
    loginTitle: "Inicia sesión en Kalki",
    loginDescription:
      "Inicia sesión para pujar en subastas, gestionar tu cartera y seguir tus artículos favoritos.",
    forgotTitle: "Restablecer tu contraseña",
    forgotDescription:
      "¿Olvidaste tu contraseña? Introduce tu email para recibir un enlace.",
    resetTitle: "Elige una nueva contraseña",
    resetDescription: "Define una nueva contraseña para tu cuenta Kalki.",
    watchlistTitle: "Favoritos",
    watchlistDescription:
      "Tus subastas favoritas — acceso rápido a los artículos que sigues.",
    ordersTitle: "Mis pedidos",
    ordersDescription:
      "Artículos que has ganado. Sigue envíos, abre disputas, define dirección de entrega.",
    kycTitle: "Verificación de identidad",
    kycDescription:
      "Verifica tu identidad para desbloquear límites más altos de retirada. Documentos cifrados en reposo.",
    addressesTitle: "Direcciones de envío",
    addressesDescription:
      "A dónde van los premios — hasta 10 direcciones, una predeterminada.",
    twofaTitle: "Autenticación en dos pasos",
    twofaDescription:
      "Añade un código de autenticador al inicio de sesión.",
    referralsTitle: "Refiere a un amigo",
    referralsDescription:
      "Comparte tu código — ambos ganan monedas bonus cuando se registra.",
    supportTitle: "Tickets de soporte",
    supportDescription:
      "¿Atascado? Cuéntanos — respondemos en horas.",
    dailyTitle: "Recompensa diaria",
    dailyDescription:
      "Recompensa más alta cada día — bonus en los días 7, 14 y 30.",
    rgTitle: "Juego responsable",
    rgDescription:
      "Define límites, toma un descanso o auto-exclúyete. Ayuda disponible en 1800-599-0019.",
    deleteTitle: "Cerrar cuenta y exportar datos",
    deleteDescription:
      "Periodo de reflexión de 30 días · descarga tus datos cuando quieras.",
    emailTitle: "Cambiar email",
    emailDescription:
      "El email actual y el nuevo deben confirmar antes de aplicarse.",
  },

  nav: {
    home: "Inicio",
    auctions: "Subastas",
    games: "Juegos",
    profile: "Perfil",
    notifications: "Notificaciones",
    watchlist: "Favoritos",
    signIn: "Entrar",
    signOut: "Salir",
    register: "Registrarse",
  },

  hub: {
    pickProduct:
      "Elige un producto para empezar. Tus monedas viajan contigo — una cartera para los tres.",
    pickProductAdmin:
      "Elige un producto para administrar. Cada tarjeta abre su consola admin.",
    greeting: "Hola, {handle}",
    adminBadge: "Admin",
    auctionsTitle: "Subastas en vivo",
    auctionsTagline:
      "La puja única más baja gana. Cada puja cuesta monedas de tu cartera.",
    auctionsAdminTagline:
      "Gestiona subastas en vivo, cierra rondas, inspecciona pujas.",
    aviatorTitle: "Aviator",
    aviatorTagline: "Retira antes de que el multiplicador caiga.",
    aviatorAdminTagline: "Analytics, log de rondas, seeds, moderación del chat.",
    exchangeTitle: "Kalki Exchange",
    exchangeTagline: "Compra acciones SÍ/NO en mercados de predicción.",
    exchangeAdminTagline:
      "Mercados, usuarios, retiradas, moderación de comentarios.",
    open: "Abrir →",
    coinsInWallet: "{coins} monedas en tu cartera.",
    topUpWallet: "Recargar cartera →",
  },

  common: {
    loading: "Cargando…",
    error: "Algo salió mal.",
    save: "Guardar",
    cancel: "Cancelar",
    submit: "Enviar",
    continue: "Continuar",
    back: "← Atrás",
    next: "Siguiente",
    close: "Cerrar",
    edit: "Editar",
    delete: "Eliminar",
    confirm: "Confirmar",
    coins: "monedas",
    sending: "Enviando…",
    saving: "Guardando…",
    submitting: "Enviando…",
    retry: "Reintentar",
  },

  switcher: {
    label: "Idioma",
    chooseLanguage: "Elige tu idioma",
  },

  auth: {
    emailLabel: "Email",
    passwordLabel: "Contraseña",
    usernameLabel: "Nombre de usuario",
    emailPlaceholder: "tu@ejemplo.com",

    signInTitle: "Inicia sesión en Kalki",
    signInButton: "Entrar",
    signingInButton: "Entrando…",
    forgotPasswordLink: "¿Olvidaste tu contraseña?",
    needAccount: "¿No tienes cuenta?",
    registerLink: "Crea una",
    invalidCredentials: "Email o contraseña inválidos.",
    telegramContinue: "Continuar con Telegram",

    registerTitle: "Crea tu cuenta Kalki",
    createAccountButton: "Crear cuenta",
    creatingAccountButton: "Creando cuenta…",
    alreadyRegistered: "¿Ya estás registrado?",
    signInLink: "Iniciar sesión",

    forgotHeading: "Restablecer contraseña",
    forgotSubtext:
      "Te enviaremos un enlace de un solo uso para definir una contraseña nueva. El enlace expira en 30 minutos.",
    forgotSendButton: "Enviar enlace",
    forgotSendingButton: "Enviando…",
    forgotSuccess:
      "Si {email} está registrado, recibirás un enlace pronto.",
    forgotRememberedIt: "¿Lo recordaste?",
    forgotBackToSignIn: "Volver al inicio de sesión",

    resetHeading: "Elige una nueva contraseña",
    newPasswordLabel: "Nueva contraseña",
    confirmPasswordLabel: "Confirmar contraseña",
    updatePasswordButton: "Actualizar contraseña",
    updatingPasswordButton: "Actualizando…",
    invalidOrExpiredLink: "Este enlace es inválido o ha expirado.",
    passwordUpdatedSignIn: "Contraseña actualizada. Inicia sesión.",
    requestNewLink: "Solicitar un nuevo enlace →",

    twofaChallenge: "Código de dos pasos",
    twofaPlaceholder: "Código de 6 dígitos",
    twofaSubmit: "Verificar",
    twofaBackupCode: "Usar un código de respaldo",
    twofaTrustDevice: "Confiar en este dispositivo por 30 días",
    twofaInvalid: "Ese código no funcionó — inténtalo de nuevo.",

    signOutButton: "Salir de los tres juegos",
    signOutDescription:
      "Cierra sesión en los tres juegos Kalki y limpia tu sesión en este dispositivo.",

    rateLimited: "Demasiados intentos — espera un minuto.",
    tooManyRequests: "Demasiadas solicitudes — espera un poco.",
    weakPassword: "Usa 8+ caracteres con letras y números.",
    emailTaken: "Ese email ya está registrado.",
    genericError: "Algo salió mal. Inténtalo de nuevo.",
  },

  auction: {
    heading: "Subastas",
    subtext:
      "Subastas de puja única más baja. Explora abajo — inicia sesión para pujar y ver tu posición en tiempo real.",
    tabLive: "En vivo",
    tabUpcoming: "Próximas",
    tabClosed: "Cerradas",
    statusLive: "En vivo",
    statusUpcoming: "Próxima",
    statusEnded: "Finalizada",
    emptyLive: "Nada en vivo ahora. Mira la pestaña Próximas.",
    emptyUpcoming: "Sin subastas programadas.",
    emptyEnded:
      "Aún sin subastas cerradas — las recientes aparecerán aquí.",
    fetchError: "No pudimos cargar las subastas: {error}.",
    retailPrice: "Precio de venta",
    coinsPerBid: "Monedas por puja",
    coinsPerBidValue: "{n} moneda",
    coinsPerBidValuePlural: "{n} monedas",
    timeStartsSoon: "empieza pronto",
    timeStartsIn: "empieza {time}",
    timeEndingNow: "terminando…",
    timeEndsIn: "termina {time}",
    timeEndedAt: "terminó {time}",
    timeEnded: "terminada",
    winnerNoneDeclared: "Sin ganador declarado.",
    winnerWonAt: "ganó con",
    backAll: "← Todas las subastas",
    winner: "Ganador",
    placeBidHeading: "Hacer una puja",
    howItWorksHeading: "Cómo funciona",
    howItWorks1: "Cada puja cuesta {coins} moneda{s} de tu cartera.",
    howItWorks2: "Elige cualquier valor entre 0,01 € y el precio de venta.",
    howItWorks3:
      "Cuando el temporizador llegue a cero, la puja única más baja gana.",
    aboutThisItem: "Sobre este artículo",
    bidNow: "Hacer puja",
    bidAmountLabel: "Importe de la puja (₹)",
    bidPlacing: "Enviando…",
    bidSuccess: "Puja registrada.",
    bidErrorInsufficientCoins:
      "Monedas insuficientes. Recarga tu cartera para seguir pujando.",
    bidErrorAuctionClosed: "Esta subasta ya no acepta pujas.",
    bidErrorRateLimited: "Tranquilo — espera antes de volver a pujar.",
    bidErrorInvalidAmount:
      "Elige un importe entre 0,01 € y el precio de venta.",
    bidErrorGeneric: "No se pudo registrar la puja.",
    bidErrorSignedOut: "Inicia sesión para pujar.",
    bidSignInPrompt: "Inicia sesión para pujar.",
    watch: "Seguir",
    watching: "Siguiendo",
    watchToggleError: "No se pudo actualizar la lista.",
  },

  profile: {
    heading: "Perfil",
    backToHub: "← Volver al hub",
    noEmail: "sin email registrado",
    adminBadge: "admin",
    sectionAccount: "Cuenta",
    sectionProfile: "Perfil",
    sectionSecurity: "Seguridad",
    sectionRG: "Juego responsable",
    sectionDaily: "Recompensa diaria",
    sectionEmail: "Cuenta",
    sectionShipping: "Envío",
    sectionIdentity: "Identidad",
    sectionReferrals: "Refiere a un amigo",
    sectionOrders: "Pedidos",
    sectionHelp: "Ayuda",
    sectionDanger: "Zona de peligro",
    sectionSignOut: "Salir",
    unifiedWallet: "Cartera unificada",
    coinsValue: "{coins} monedas",
    unifiedNote: "Mismo saldo en Subastas, Aviator y Kalki Exchange.",
    displayNameTitle: "Nombre y avatar",
    displayNameSubtext:
      "Tu cara pública en Kalki — renombrable cada 30 días",
    twofaTitle: "Autenticación en dos pasos",
    twofaSubtext: "Añade un código de autenticador al inicio de sesión",
    rgTitle: "Límites, descansos, auto-exclusión",
    rgSubtext:
      "Define límites o tómate un descanso — ayuda en 1800-599-0019",
    dailyTitle: "Racha diaria",
    dailySubtext:
      "Recompensa más alta cada día — bonus en los días 7, 14 y 30",
    emailTitle: "Cambiar email",
    emailSubtext:
      "El email actual y el nuevo deben confirmar antes del cambio",
    addressesTitle: "Direcciones de envío",
    addressesSubtext: "A dónde van los premios — hasta 10, una por defecto",
    kycTitle: "Verificación KYC",
    kycSubtext:
      "Verifica tu identidad para desbloquear límites más altos",
    referralsTitle: "Comparte tu código",
    referralsSubtext:
      "Gana monedas cuando un amigo se registre y recargue",
    ordersTitle: "Seguir envíos",
    ordersSubtext:
      "Artículos ganados — elige dirección, mira cómo llegan",
    supportTitle: "Tickets de soporte",
    supportSubtext: "¿Atascado? Cuéntanos — respondemos en horas",
    deleteTitle: "Cerrar cuenta y exportar datos",
    deleteSubtext: "30 días de reflexión · descarga tus datos cuando quieras",
  },

  me: {
    profileHeading: "Perfil",
    profileSubtext:
      "Tu @{handle} es el identificador único (visible en historiales de pujas y recibos). Nombre y avatar son lo que ven los demás.",
    accountLink: "← Cuenta",

    dailyHeading: "Recompensa diaria",
    dailySubtext:
      "Entra cada día para aumentar tu racha. Bonus extra en los días 7, 14 y 30.",
    dailyClaim: "Reclamar la recompensa de hoy",
    dailyClaimed: "Reclamada",
    dailyStreak: "Racha de {days} días",

    twofaHeading: "Autenticación en dos pasos",
    twofaSubtext:
      "Añade un código de autenticador al login. Google Authenticator, 1Password, Authy etc.",
    twofaEnable: "Activar 2FA",
    twofaDisable: "Desactivar 2FA",
    twofaEnabled: "2FA activado",

    addressesHeading: "Direcciones de envío",
    addressesSubtext:
      "Hasta 10 direcciones. Una por defecto — usada al ganar, salvo que cambies.",
    addressesAdd: "Añadir nueva dirección",
    addressesEmpty:
      "Sin direcciones. Añade una antes de ganar tu primera subasta.",
    addressesMakeDefault: "Marcar como predeterminada",
    addressesDefault: "Predeterminada",
    addressesDelete: "Eliminar",

    kycHeading: "Verificación de identidad",
    kycSubtext:
      "Necesaria para desbloquear límites más altos. Documentos cifrados en reposo.",
    kycSubmit: "Enviar para revisión",
    kycPending: "En revisión",
    kycApproved: "Aprobado",
    kycRejected: "Rechazado — vuelve a enviar abajo",

    ordersHeading: "Mis pedidos",
    ordersSubtext:
      "Artículos ganados. Sigue envíos, abre disputas, define dirección.",
    ordersEmpty: "Sin pedidos. Gana una subasta y aparecerá aquí.",
    ordersOpenAddress: "Elegir dirección",
    ordersAwaiting: "Esperando envío",
    ordersInTransit: "En tránsito",
    ordersDelivered: "Entregado",
    ordersDisputed: "En disputa",
    ordersCancelled: "Cancelado",
    ordersTrack: "Seguir →",
    ordersOpenDispute: "Abrir disputa",

    referralsHeading: "Refiere a un amigo",
    referralsSubtext:
      "Comparte tu código. Cuando un amigo se registre y haga su primera recarga, ambos ganáis bonus.",
    referralsCodeLabel: "Tu código",
    referralsCopy: "Copiar",
    referralsCopied: "Copiado",
    referralsClaim: "Reclamar bonus",

    supportHeading: "Tickets de soporte",
    supportSubtext:
      "¿Atascado? Cuéntanos — respondemos en pocas horas.",
    supportNew: "Nuevo ticket",
    supportEmpty: "Sin tickets. Abre uno y te contestaremos.",
    supportOpen: "Abierto",
    supportClosed: "Cerrado",
    supportPlaceholder: "Describe qué pasó…",
    supportSend: "Enviar",

    watchlistHeading: "Favoritos",
    watchlistSubtext:
      "Subastas favoritas. Te avisamos antes de cerrar cada una.",
    watchlistEmpty:
      "Aún no has marcado ninguna subasta. Pulsa la estrella para añadir.",

    emailHeading: "Cambiar email",
    emailSubtext:
      "El email actual y el nuevo deben confirmar antes del cambio. Enviaremos un enlace a cada uno.",
    emailNewLabel: "Nuevo email",
    emailRequestChange: "Solicitar cambio",
    emailRequestPending:
      "Pendiente — revisa ambos correos para el enlace de confirmación.",
    emailCancelChange: "Cancelar cambio pendiente",

    deleteHeading: "Cerrar cuenta",
    deleteSubtext:
      "Cierra tu cuenta Kalki en los tres juegos. Reflexión de 30 días — inicia sesión antes para cancelar.",
    deleteConfirmLabel: "Escribe DELETE para confirmar",
    deleteButton: "Cerrar mi cuenta",
    dataExport: "Descargar mis datos",
    dataExportSubtext:
      "Exportación GDPR de tu cuenta, historial de cartera y pujas en JSON.",

    rgHeading: "Juego responsable",
    rgSubtext:
      "Define límites. Reducirlos es inmediato; aumentarlos requiere 24 h de espera.",
    rgCooldown: "Tomar un descanso",
    rgSelfExclude: "Auto-excluirse",
    rgWeeklyLimit: "Límite semanal",
    rgDailyLimit: "Límite diario",
    rgSessionLimit: "Límite por sesión",
    rgHelpline:
      "Si necesitas ayuda, llama al 1800-599-0019 (KIRAN — línea de salud mental, India).",
  },

  notifications: {
    heading: "Notificaciones",
    subtext:
      "Actualizaciones de pedido, estado de pujas, respuestas de soporte y recompensas.",
    unreadCount: "{count} sin leer",
    allRead: "Todo leído.",
    markAllRead: "Marcar todo como leído",
    emptyState:
      "Estás al día. Haz una puja para empezar a recibir notificaciones.",
    preferencesHeading: "Preferencias de notificación",
    preferencesEmail: "Recibir email sobre",
    preferencesPush: "Notificaciones push",
  },

  share: {
    button: "Compartir",
    copied: "Copiado",
    shared: "Compartido.",
    linkCopied: "Enlace copiado al portapapeles.",
    couldntCopy:
      "No se pudo copiar — tu navegador bloqueó el acceso al portapapeles.",
    ariaLabel: "Compartir esta subasta",
  },

  errors: {
    genericNetwork: "Error de red. Inténtalo de nuevo.",
    signedOut: "Inicia sesión.",
    notFound: "Página no encontrada",
    notFoundDescription:
      "La página que buscas no existe o se ha movido.",
    backHome: "Volver al inicio",
    generic: "Algo salió mal.",
    unauthorized: "Inicia sesión.",
    forbidden: "No tienes acceso a esta página.",
    serverError: "Error del servidor. Inténtalo en unos instantes.",
  },

  toast: {
    saved: "Guardado.",
    copied: "Copiado.",
    error: "Algo salió mal.",
    submitted: "Enviado.",
  },

  topup: {
    label: "Recargar",
    coinsLabel: "monedas",
    open: "Abrir cartera",
  },
};

export default es;

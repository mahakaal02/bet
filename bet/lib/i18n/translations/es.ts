import type { Dictionary } from "./en";

/**
 * Spanish (es, broad-LatAm baseline). Same fallback semantics as
 * pt.ts — missing keys defer to en.ts via the deep walker.
 *
 * Style choices: neutral LatAm Spanish (no "vosotros", no
 * country-specific slang) so it reads naturally across MX/AR/CO/CL.
 * Castilian users in Spain will recognise everything; the trade-off
 * is intentional since LatAm dominates the platform's Spanish-
 * speaking traffic.
 */
const es: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Exchange",
    tagline:
      "Negocia SÍ/NO en eventos del mundo real con tus monedas Kalki Bet — la misma billetera que alimenta las subastas y Aviator.",
    description:
      "Mercados de predicción, subastas en vivo y crash-game — una billetera, tres productos, todo con monedas demo.",
  },
  nav: {
    home: "Inicio",
    markets: "Mercados",
    portfolio: "Portafolio",
    wallet: "Billetera",
    profile: "Perfil",
    leaderboard: "Clasificación",
    notifications: "Notificaciones",
    signIn: "Iniciar sesión",
    signOut: "Cerrar sesión",
    register: "Registrarse",
  },
  landing: {
    heroKicker: "Predice. Negocia. Gana.",
    heroTitle: "Eventos reales. Opiniones reales. Apuestas reales.",
    heroDescription:
      "Elige un lado, define tu precio, observa cómo se mueve el mercado. Retira en cualquier momento antes de que el evento se resuelva.",
    ctaPrimary: "Ver mercados",
    ctaSecondary: "Cómo funciona",
    statsMarkets: "Mercados activos",
    statsUsers: "Jugadores",
    statsTrades: "Negociaciones realizadas",
    trendingHeader: "Mercados destacados",
    leaderboardHeader: "Mejores traders",
  },
  wallet: {
    title: "Tu billetera",
    balance: "Saldo de monedas",
    buyCoins: "Comprar monedas",
    withdraw: "Retirar",
    minWithdraw: "Mín. {amount} monedas",
    payWithCrypto:
      "Paga con cripto — BTC, ETH, USDT, USDC y 200 más. Tus monedas se acreditan automáticamente al confirmarse el pago en la cadena.",
    askAdmin: "Habla con un administrador en Secure Kalki Chat para pagos",
    downloadChatApp: "Descarga Secured Chat App ahora",
    unifiedPromise:
      "Un solo saldo en Mercados, Subastas y Aviator. Cada recarga aparece en tu historial.",
  },
  market: {
    yes: "SÍ",
    no: "NO",
    volume: "Volumen",
    ends: "Termina",
    resolved: "Resuelto",
    cancelled: "Cancelado",
    place_bet: "Apostar",
    cash_out: "Retirar",
    order_book: "Libro de órdenes",
    trades: "Negociaciones",
    comments: "Comentarios",
  },
  auth: {
    email: "Correo",
    username: "Usuario",
    password: "Contraseña",
    signInTitle: "Inicia sesión en Kalki Exchange",
    registerTitle: "Crea tu cuenta Kalki",
    forgotPassword: "¿Olvidaste tu contraseña?",
    needAccount: "¿No tienes cuenta?",
    haveAccount: "¿Ya tienes cuenta?",
    googleSignIn: "Iniciar sesión con Google",
    errors: {
      invalidCredentials: "Correo o contraseña incorrectos.",
      emailTaken: "Ese correo ya está registrado.",
      usernameTaken: "Ese nombre de usuario ya está en uso.",
      weakPassword: "Usa 8+ caracteres con letras y números.",
    },
  },
  switcher: {
    label: "Idioma",
    chooseLanguage: "Elige tu idioma",
  },
  banner: {
    geoSuggest: "¿Ver este sitio en {language}?",
    geoSuggestYes: "Sí, cambiar",
    geoSuggestNo: "Seguir en inglés",
  },
  errors: {
    notFound: "Página no encontrada",
    notFoundDescription: "La página que buscas no existe o fue movida.",
    backHome: "Volver al inicio",
  },
};

export default es;

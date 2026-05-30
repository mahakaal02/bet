/**
 * Portuguese (Brazilian) translations — PR-AVIATOR-I18N.
 *
 * Partial dictionary: any string omitted here falls back to English
 * via the deep-merge in `../index.ts::dictionaryFor`. Aim for natural,
 * conversational pt-BR — players don't read formal Portuguese, they
 * read what Brazilian streamers and gambling sites use.
 */

import type { Dictionary } from "./en";

const pt: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Aviator",
    tagline:
      "Jogo de aposta na curva de crash — veja o avião subir, retire antes de cair.",
    description:
      "Jogo de multiplicador em tempo real com sua carteira Kalki. Faça uma aposta, veja o multiplicador subir, saque antes do avião cair. Comprovadamente justo.",
    homeTitle: "Kalki Aviator — jogo de multiplicador",
    homeDescription:
      "Veja o avião subir, saque antes de cair. Jogo de multiplicador comprovadamente justo. Uma carteira para Markets, Auctions e Aviator.",
    fairnessTitle: "Comprovadamente justo — verifique cada rodada",
    fairnessDescription:
      "Cada multiplicador é derivado de uma seed do servidor comprometida antes da rodada. Verifique qualquer rodada direto no seu navegador.",
    profileTitle: "Sua conta",
    profileDescription:
      "Gerencie sua conta Kalki, veja seu saldo e desconecte de todos os três jogos.",
    notificationsTitle: "Notificações",
    notificationsDescription:
      "Crashes de rodada, confirmações de saque e rotações de seed aparecem aqui.",
    withdrawTitle: "Sacar moedas",
    withdrawDescription:
      "Saque suas moedas Kalki para UPI ou banco. Cada pedido é revisado antes do pagamento.",
    logoutTitle: "Encerrando sua sessão",
    logoutDescription: "Limpando sua sessão do Kalki Aviator.",
  },

  nav: {
    home: "Início",
    profile: "Perfil",
    notifications: "Notificações",
    withdraw: "Sacar",
    fairness: "Transparência",
    logout: "Sair",
    backToGame: "Voltar ao jogo",
    backToAviator: "Voltar ao Aviator",
    backToKalkiHub: "Voltar ao Kalki",
    myStats: "Minhas estatísticas",
  },

  switcher: {
    label: "Idioma",
    chooseLanguage: "Escolha seu idioma",
  },

  common: {
    loading: "Carregando…",
    error: "Erro",
    save: "Salvar",
    cancel: "Cancelar",
    submit: "Enviar",
    continue: "Continuar",
    back: "Voltar",
    close: "Fechar",
    coins: "moedas",
    online: "Online",
  },

  game: {
    startsIn: "Começa em",
    almost: "Quase!",
    inFlight: "Em voo",
    crashed: "Caiu",
    connecting: "Conectando",
    connectingToArena: "Conectando à arena…",
    reconnecting: "Reconectando…",

    bet: "Apostar",
    auto: "Auto",
    betAmount: "Valor da aposta em moedas",
    autoCashoutAt: "Saque automático em",
    autoCashoutAria: "Multiplicador de saque automático",
    placeBet: "APOSTAR",
    placeBetHero: "FAZER APOSTA",
    topUpToBet: "RECARREGAR PARA APOSTAR",
    topUpToBetSub: "Adicionar moedas",
    cashout: "SACAR",
    busted: "PERDEU",
    betPlaced: "APOSTA FEITA",
    waitingForRound: "moedas · aguardando rodada",
    waitForNextRound: "AGUARDE A PRÓXIMA RODADA",
    bettingOpensSoon: "As apostas abrem em alguns segundos",
    cashedOut: "RETIRADO",
    waitingForFinish: "Aguardando o fim da rodada",
    maxPayoutReached: "PAGAMENTO MÁXIMO ATINGIDO",
    autoCashedOut: "Sacado automaticamente",
    waiting: "AGUARDANDO…",

    minBetCoins: "Aposta mínima é {min} moedas",
    minBet: "Aposta mín. {min} moedas",
    walletHasOnly: "Carteira tem apenas {amount}",
    walletHasTopUp: "Carteira tem {amount} — recarregue para apostar.",
    autoCashoutMinError: "Saque automático deve ser pelo menos 1.01×",
    cashedOutAt: "Sacado em {multiplier}× · +{coins}",
    wallet: "Carteira",
    maxChip: "Máx",

    recent: "Recentes",
    waitingForFirstRound: "Aguardando primeira rodada…",
    roundHistory: "Histórico de Rodadas",
    showFullHistory: "Mostrar histórico completo",
    closeRoundHistory: "Fechar histórico",
    noRoundsYet: "Sem rodadas ainda. O primeiro crash aparecerá aqui.",
    roundLabel: "Rodada #{n} — {tier}",

    players: "Jogadores",
    betVolume: "Vol. apostas",
    paidOut: "Pago",
    noBetsYet: "Sem apostas nesta rodada.",
    waitingForNextRound: "Aguardando próxima rodada…",
    cashedOutCount: "Sacaram · {count}",
    autoCashoutTarget: "Alvo de saque automático",
    autoLabel: "auto",
    recentWinners: "Ganhadores recentes",
    noCashoutsYet: "Sem saques nesta sessão.",

    liveChat: "Chat ao vivo",
    chatPlaceholder: "Diga algo…",
    chatBeFirst: "Seja o primeiro a falar.",
    chatYou: "você",
    chatSend: "Enviar",
    chatSendFailed: "falha ao enviar",
  },

  wallet: {
    balance: "Saldo da carteira",
    topUp: "+ Recarregar",
    encash: "Sacar",
    topUpTitle: "Recarregar sua carteira",
    manageWallet: "Gerenciar carteira",
    encashUnlocks: "Saque libera em {min} — faltam {remaining}.",
    encashTooltipUnlocked: "Sacar para seu banco / UPI",
    encashTooltipLocked: "Atinja {min} para habilitar saques",
    minWithdraw: "mín. {amount} moedas",
    unifiedWallet: "Carteira unificada",
    unifiedNote: "Mesmo saldo em Auctions, Aviator e Kalki Exchange.",
  },

  fairness: {
    title: "Comprovadamente justo",
    description:
      "Cada multiplicador de crash do Aviator é derivado de uma seed do servidor comprometida antes da rodada (com hash público) e uma seed cliente determinística. A seed é revelada quando o lote rotaciona — neste momento qualquer pessoa pode recalcular cada multiplicador e verificar que o servidor não trapaceou. Clique em Verificar em qualquer rodada abaixo para recomputar no seu navegador.",
    activeSeed: "Seed ativa",
    noActiveSeed: "Sem seed ativa.",
    seedHidden:
      "A serverSeed em si fica oculta até a rotação — esse é o compromisso.",
    recentRounds: "Rodadas recentes",
    columnRound: "Rodada",
    columnCrash: "Crash",
    columnNonce: "Nonce",
    columnSeedStatus: "Status da seed",
    seedRevealed: "revelada (lote rotacionado)",
    seedVerifiable: "verificável",
    verify: "verificar",
    verifying: "verificando…",
    revealedBatches: "Lotes de seed revelados",
    noBatchesYet:
      "Nenhum lote rotacionado ainda. Quando um admin rotacionar a seed ativa (ou o teto de auto-rotação disparar), a seed aparecerá aqui com o intervalo de rodadas cobertas.",
    rangeRounds: "rodadas #{from}–#{to}",
    howItWorks: "Como funciona a verificação",
    howItWorksBody:
      "Para cada rodada calculamos HMAC-SHA256(serverSeed, \"{clientSeed}:{nonce}\"). Pegamos os primeiros 13 caracteres hex como um inteiro e; o multiplicador de crash é floor(100 · 2^52 / (2^52 − e)) / 100, com duas casas decimais — exceto 1 em 33 rodadas (≈3% de vantagem da casa) que dão crash instantâneo em 1.00. O botão verificar faz isso no seu navegador usando a Web Crypto API.",
  },

  notifications: {
    heading: "Notificações",
    subtext:
      "Crashes de rodada, confirmações de saque e rotações de seed aparecerão aqui.",
    emptyState: "Você está em dia.",
  },

  profile: {
    backToAviator: "← Voltar ao Aviator",
    account: "Conta",
    unifiedWallet: "Carteira unificada",
    unifiedNote: "Mesmo saldo em Auctions, Aviator e Kalki Exchange.",
    signOut: "Sair",
    signOutAllDescription:
      "Encerra sua sessão nos três jogos Kalki e limpa os dados deste dispositivo.",
    signOutButton: "Sair de todos os jogos",
    signingOut: "Encerrando…",
    defaultEmail: "Conta de e-mail",
  },

  withdraw: {
    opening: "Abrindo saque…",
    redirecting: "Redirecionando para a carteira Kalki para enviar seu pedido.",
  },

  logout: {
    signingOut: "Encerrando sua sessão…",
    bridging: "Conectando sua sessão Kalki Aviator — isso só acontece uma vez.",
  },

  stats: {
    title: "Minhas Estatísticas",
    closeAria: "Fechar estatísticas",
    rangeDay: "Dia",
    rangeWeek: "Semana",
    rangeMonth: "Mês",
    rangeAll: "Tudo",
    biggestX: "Maior X",
    biggestWin: "Maior Ganho",
    totalBets: "Total de Apostas",
    winRate: "Taxa de Vitória",
    wagered: "Apostado",
    netPL: "L/P Líquido",
    winsLosses: "{wins} ganhas · {losses} perdidas",
    loading: "Carregando estatísticas…",
    loadFailed: "Não foi possível carregar.",
    footnoteDay: "Últimas 24 horas · amostra das suas 200 apostas mais recentes",
    footnoteWeek: "Últimos 7 dias · amostra das suas 200 apostas mais recentes",
    footnoteMonth: "Últimos 30 dias · amostra das suas 200 apostas mais recentes",
    footnoteAll: "Desde a criação da conta · amostra das suas 200 apostas mais recentes",
  },

  errors: {
    genericNetwork: "Erro de rede. Tente novamente.",
    signedOut: "Faça login.",
    insufficientBalance: "Saldo insuficiente na sua carteira.",
    couldntLoad: "Não foi possível carregar.",
  },
};

export default pt;

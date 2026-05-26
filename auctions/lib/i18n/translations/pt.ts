import type { Dictionary } from "./en";

/**
 * Portuguese (pt-BR baseline). Strings missing from this dictionary
 * fall back to the English copy in `./en.ts` via the deep-fallback
 * walker in `../index.ts::t`.
 *
 * Translation notes (PR-AUCTIONS-I18N):
 *   - Initial pass is machine-translated + lightly hand-edited for
 *     iGaming / e-commerce tone. Product/QA should review before
 *     going live.
 *   - "moedas" (coins) reads cleanly in pt-BR for demo coins.
 *   - "leilão / leilões" for auction(s); "lance" for bid (used in
 *     Brazilian Portuguese auction sites).
 */
const pt: Partial<Dictionary> = {
  meta: {
    siteName: "Kalki Leilões",
    tagline:
      "Leilões de menor lance único movidos por moedas Kalki — a mesma carteira que alimenta os mercados de previsão e o Aviator.",
    description:
      "Dê lances em produtos reais com moedas Kalki. O menor lance único vence. Uma carteira para Leilões, Aviator e Exchange.",
    homeTitle: "Kalki — escolha um jogo, uma carteira",
    homeDescription:
      "Três jogos, uma carteira. Leilões, Aviator e a Kalki Exchange. Escolha onde gastar suas moedas.",
    auctionsTitle: "Leilões ao vivo — menor lance único vence",
    auctionsDescription:
      "Veja os leilões ao vivo, futuros e encerrados. Pague moedas por lance e o menor lance único leva um produto real.",
    auctionDetailTitle: "Detalhes do leilão",
    auctionDetailDescription:
      "Dê seu lance neste leilão. O menor lance único vence — veja o status e o tempo restante.",
    profileTitle: "Seu perfil",
    profileDescription:
      "Gerencie sua conta, endereços, KYC, segurança e indicações no ecossistema Kalki.",
    notificationsTitle: "Notificações",
    notificationsDescription:
      "Atualizações de pedido, status de lance, respostas de suporte e recompensas — tudo que aconteceu enquanto você esteve fora.",
    loginTitle: "Entrar na Kalki",
    loginDescription:
      "Entre para dar lances em leilões, gerenciar sua carteira e acompanhar seus itens favoritos.",
    forgotTitle: "Redefinir sua senha",
    forgotDescription:
      "Esqueceu a senha? Digite seu e-mail para receber um link de redefinição.",
    resetTitle: "Escolha uma nova senha",
    resetDescription: "Defina uma nova senha para sua conta Kalki.",
    watchlistTitle: "Favoritos",
    watchlistDescription:
      "Seus leilões favoritados — acesso rápido aos itens que você acompanha.",
    ordersTitle: "Meus pedidos",
    ordersDescription:
      "Itens que você ganhou. Acompanhe envios, abra uma disputa, defina um endereço de entrega.",
    kycTitle: "Verificação de identidade",
    kycDescription:
      "Verifique sua identidade para desbloquear limites maiores de saque. Documentos criptografados em repouso.",
    addressesTitle: "Endereços de entrega",
    addressesDescription:
      "Para onde os prêmios são enviados — até 10 endereços, um padrão.",
    twofaTitle: "Autenticação em dois fatores",
    twofaDescription:
      "Adicione um código de autenticador ao seu login para mais segurança.",
    referralsTitle: "Indique um amigo",
    referralsDescription:
      "Compartilhe seu código — quando alguém se cadastra com ele, ambos ganham moedas bônus.",
    supportTitle: "Tickets de suporte",
    supportDescription:
      "Travou em algo? Conte pra gente — respondemos em poucas horas.",
    dailyTitle: "Recompensa diária",
    dailyDescription:
      "Recompensa maior a cada dia — bônus nos dias 7, 14 e 30.",
    rgTitle: "Jogo responsável",
    rgDescription:
      "Defina limites, peça uma pausa ou auto-exclua-se. Ajuda disponível no 1800-599-0019.",
    deleteTitle: "Encerrar conta e exportação de dados",
    deleteDescription:
      "Período de reflexão de 30 dias · baixe seus dados a qualquer momento.",
    emailTitle: "Alterar e-mail",
    emailDescription:
      "Tanto o e-mail atual quanto o novo precisam confirmar antes da alteração ser aplicada.",
  },

  nav: {
    home: "Início",
    auctions: "Leilões",
    games: "Jogos",
    profile: "Perfil",
    notifications: "Notificações",
    watchlist: "Favoritos",
    signIn: "Entrar",
    signOut: "Sair",
    register: "Cadastrar",
  },

  hub: {
    pickProduct:
      "Escolha um produto para começar. Suas moedas vão com você — uma carteira para os três.",
    pickProductAdmin:
      "Escolha um produto para gerenciar. Cada bloco abre o console admin.",
    greeting: "Olá, {handle}",
    adminBadge: "Admin",
    auctionsTitle: "Leilões ao vivo",
    auctionsTagline:
      "Menor lance único vence. Cada lance custa moedas da sua carteira.",
    auctionsAdminTagline:
      "Gerencie leilões ao vivo, feche rodadas, inspecione lances.",
    aviatorTitle: "Aviator",
    aviatorTagline: "Saque antes que o multiplicador caia.",
    aviatorAdminTagline: "Analytics, log de rodadas, seeds, moderação do chat.",
    exchangeTitle: "Kalki Exchange",
    exchangeTagline: "Negocie ações SIM/NÃO em mercados de previsão.",
    exchangeAdminTagline: "Mercados, usuários, saques, moderação de comentários.",
    open: "Abrir →",
    coinsInWallet: "{coins} moedas na sua carteira.",
    topUpWallet: "Recarregar carteira →",
  },

  common: {
    loading: "Carregando…",
    error: "Algo deu errado.",
    save: "Salvar",
    cancel: "Cancelar",
    submit: "Enviar",
    continue: "Continuar",
    back: "← Voltar",
    next: "Próximo",
    close: "Fechar",
    edit: "Editar",
    delete: "Excluir",
    confirm: "Confirmar",
    coins: "moedas",
    sending: "Enviando…",
    saving: "Salvando…",
    submitting: "Enviando…",
    retry: "Tentar novamente",
  },

  switcher: {
    label: "Idioma",
    chooseLanguage: "Escolha seu idioma",
  },

  auth: {
    emailLabel: "E-mail",
    passwordLabel: "Senha",
    usernameLabel: "Nome de usuário",
    emailPlaceholder: "voce@exemplo.com",

    signInTitle: "Entrar na Kalki",
    signInButton: "Entrar",
    signingInButton: "Entrando…",
    forgotPasswordLink: "Esqueci minha senha",
    needAccount: "Não tem conta?",
    registerLink: "Crie uma",
    invalidCredentials: "E-mail ou senha inválidos.",
    telegramContinue: "Continuar com Telegram",

    registerTitle: "Crie sua conta Kalki",
    createAccountButton: "Criar conta",
    creatingAccountButton: "Criando conta…",
    alreadyRegistered: "Já tem conta?",
    signInLink: "Entrar",

    forgotHeading: "Redefinir senha",
    forgotSubtext:
      "Vamos enviar um link único para você definir uma nova senha. O link expira em 30 minutos.",
    forgotSendButton: "Enviar link",
    forgotSendingButton: "Enviando…",
    forgotSuccess:
      "Se {email} estiver cadastrado, você receberá um link em instantes.",
    forgotRememberedIt: "Lembrou?",
    forgotBackToSignIn: "Voltar para entrar",

    resetHeading: "Escolha uma nova senha",
    newPasswordLabel: "Nova senha",
    confirmPasswordLabel: "Confirmar senha",
    updatePasswordButton: "Atualizar senha",
    updatingPasswordButton: "Atualizando…",
    invalidOrExpiredLink: "Este link é inválido ou expirou.",
    passwordUpdatedSignIn: "Senha atualizada. Faça login novamente.",
    requestNewLink: "Solicitar um novo link →",

    twofaChallenge: "Código de dois fatores",
    twofaPlaceholder: "Código de 6 dígitos",
    twofaSubmit: "Verificar",
    twofaBackupCode: "Usar um código reserva",
    twofaTrustDevice: "Confiar neste dispositivo por 30 dias",
    twofaInvalid: "Esse código não funcionou — tente de novo.",

    signOutButton: "Sair de todos os jogos",
    signOutDescription:
      "Faz logout dos três jogos Kalki e limpa sua sessão neste dispositivo.",

    rateLimited: "Tentativas demais — aguarde um minuto.",
    tooManyRequests: "Requisições demais — aguarde um pouco.",
    weakPassword: "Use 8+ caracteres com letras e números.",
    emailTaken: "Esse e-mail já está cadastrado.",
    genericError: "Algo deu errado. Tente novamente.",
  },

  auction: {
    heading: "Leilões",
    subtext:
      "Leilões de menor lance único. Explore abaixo — entre para dar lances e acompanhar sua posição em tempo real.",
    tabLive: "Ao vivo",
    tabUpcoming: "Próximos",
    tabClosed: "Encerrados",
    statusLive: "Ao vivo",
    statusUpcoming: "Em breve",
    statusEnded: "Encerrado",
    emptyLive: "Nada ao vivo agora. Veja a aba Próximos.",
    emptyUpcoming: "Nenhum leilão programado.",
    emptyEnded: "Nenhum leilão encerrado ainda — os recentes aparecem aqui.",
    fetchError: "Não conseguimos acessar os leilões: {error}.",
    retailPrice: "Preço de varejo",
    coinsPerBid: "Moedas por lance",
    coinsPerBidValue: "{n} moeda",
    coinsPerBidValuePlural: "{n} moedas",
    timeStartsSoon: "começa em breve",
    timeStartsIn: "começa {time}",
    timeEndingNow: "encerrando…",
    timeEndsIn: "termina {time}",
    timeEndedAt: "encerrado {time}",
    timeEnded: "encerrado",
    winnerNoneDeclared: "Sem vencedor declarado.",
    winnerWonAt: "venceu em",
    backAll: "← Todos os leilões",
    winner: "Vencedor",
    placeBidHeading: "Dar um lance",
    howItWorksHeading: "Como funciona",
    howItWorks1: "Cada lance custa {coins} moeda{s} da sua carteira.",
    howItWorks2: "Escolha qualquer valor de R$0,01 até o preço de varejo.",
    howItWorks3:
      "Quando o tempo zerar, o menor lance único vence o produto.",
    aboutThisItem: "Sobre este item",
    bidNow: "Dar lance",
    bidAmountLabel: "Valor do lance (₹)",
    bidPlacing: "Enviando…",
    bidSuccess: "Lance registrado.",
    bidErrorInsufficientCoins:
      "Moedas insuficientes. Recarregue para continuar dando lances.",
    bidErrorAuctionClosed: "Este leilão não aceita mais lances.",
    bidErrorRateLimited: "Calma — aguarde antes de dar outro lance.",
    bidErrorInvalidAmount:
      "Escolha um valor entre R$0,01 e o preço de varejo.",
    bidErrorGeneric: "Não foi possível registrar o lance.",
    bidErrorSignedOut: "Faça login para dar lance.",
    bidSignInPrompt: "Entre para dar um lance.",
    watch: "Acompanhar",
    watching: "Acompanhando",
    watchToggleError: "Não foi possível atualizar a lista.",
  },

  profile: {
    heading: "Perfil",
    backToHub: "← Voltar ao hub",
    noEmail: "sem e-mail cadastrado",
    adminBadge: "admin",
    sectionAccount: "Conta",
    sectionProfile: "Perfil",
    sectionSecurity: "Segurança",
    sectionRG: "Jogo responsável",
    sectionDaily: "Recompensa diária",
    sectionEmail: "Conta",
    sectionShipping: "Entrega",
    sectionIdentity: "Identidade",
    sectionReferrals: "Indique um amigo",
    sectionOrders: "Pedidos",
    sectionHelp: "Ajuda",
    sectionDanger: "Zona de perigo",
    sectionSignOut: "Sair",
    unifiedWallet: "Carteira unificada",
    coinsValue: "{coins} moedas",
    unifiedNote: "Mesmo saldo em Leilões, Aviator e Kalki Exchange.",
    displayNameTitle: "Nome de exibição e avatar",
    displayNameSubtext:
      "Sua identidade pública na Kalki — pode ser alterada a cada 30 dias",
    twofaTitle: "Autenticação em dois fatores",
    twofaSubtext: "Adicione um código de autenticador ao login",
    rgTitle: "Limites, pausas, auto-exclusão",
    rgSubtext:
      "Defina limites ou tire um tempo — ajuda no 1800-599-0019",
    dailyTitle: "Sequência diária",
    dailySubtext: "Recompensa maior a cada dia — bônus nos dias 7, 14 e 30",
    emailTitle: "Alterar e-mail",
    emailSubtext:
      "O e-mail atual e o novo precisam confirmar antes da troca",
    addressesTitle: "Endereços de entrega",
    addressesSubtext: "Para onde os prêmios vão — até 10, um padrão",
    kycTitle: "Verificação KYC",
    kycSubtext: "Verifique sua identidade para liberar limites maiores",
    referralsTitle: "Compartilhe seu código",
    referralsSubtext:
      "Ganhe moedas quando um amigo se cadastrar e recarregar",
    ordersTitle: "Acompanhar entregas",
    ordersSubtext:
      "Itens que você venceu — escolha um endereço, acompanhe a entrega",
    supportTitle: "Tickets de suporte",
    supportSubtext: "Travou? Conta pra gente — respondemos rápido",
    deleteTitle: "Encerrar conta e exportar dados",
    deleteSubtext: "30 dias de reflexão · baixe seus dados quando quiser",
  },

  me: {
    profileHeading: "Perfil",
    profileSubtext:
      "Seu @{handle} é o identificador único (visível em históricos de lances e recibos). Nome de exibição e avatar são o que os outros veem.",
    accountLink: "← Conta",

    dailyHeading: "Recompensa diária",
    dailySubtext:
      "Entre todo dia para aumentar sua sequência. Bônus extra nos dias 7, 14 e 30.",
    dailyClaim: "Resgatar recompensa de hoje",
    dailyClaimed: "Resgatado",
    dailyStreak: "Sequência de {days} dias",

    twofaHeading: "Autenticação em dois fatores",
    twofaSubtext:
      "Adicione um código de autenticador ao seu login. Google Authenticator, 1Password, Authy etc.",
    twofaEnable: "Ativar 2FA",
    twofaDisable: "Desativar 2FA",
    twofaEnabled: "2FA está ativo",

    addressesHeading: "Endereços de entrega",
    addressesSubtext:
      "Até 10 endereços. Um padrão — usado quando você ganha, exceto se trocar.",
    addressesAdd: "Adicionar novo endereço",
    addressesEmpty:
      "Nenhum endereço ainda. Adicione um antes de vencer seu primeiro leilão.",
    addressesMakeDefault: "Definir como padrão",
    addressesDefault: "Padrão",
    addressesDelete: "Excluir",

    kycHeading: "Verificação de identidade",
    kycSubtext:
      "Necessário para liberar limites maiores de saque. Documentos são criptografados.",
    kycSubmit: "Enviar para revisão",
    kycPending: "Em análise",
    kycApproved: "Aprovado",
    kycRejected: "Rejeitado — reenvie abaixo",

    ordersHeading: "Meus pedidos",
    ordersSubtext:
      "Itens que você ganhou. Acompanhe envios, abra disputas, defina endereço.",
    ordersEmpty: "Nenhum pedido ainda. Vença um leilão e ele aparecerá aqui.",
    ordersOpenAddress: "Escolher endereço",
    ordersAwaiting: "Aguardando envio",
    ordersInTransit: "Em trânsito",
    ordersDelivered: "Entregue",
    ordersDisputed: "Em disputa",
    ordersCancelled: "Cancelado",
    ordersTrack: "Rastrear →",
    ordersOpenDispute: "Abrir disputa",

    referralsHeading: "Indique um amigo",
    referralsSubtext:
      "Compartilhe seu código. Quando um amigo se cadastra e faz a primeira recarga, ambos ganham bônus.",
    referralsCodeLabel: "Seu código",
    referralsCopy: "Copiar",
    referralsCopied: "Copiado",
    referralsClaim: "Resgatar bônus",

    supportHeading: "Tickets de suporte",
    supportSubtext:
      "Travou em algo? Conta pra gente — respondemos em poucas horas.",
    supportNew: "Novo ticket",
    supportEmpty: "Sem tickets. Abra um e responderemos rápido.",
    supportOpen: "Aberto",
    supportClosed: "Encerrado",
    supportPlaceholder: "Descreva o que aconteceu…",
    supportSend: "Enviar",

    watchlistHeading: "Favoritos",
    watchlistSubtext:
      "Leilões favoritados. Avisamos antes de cada um terminar.",
    watchlistEmpty:
      "Você ainda não favoritou nenhum leilão. Toque na estrela do leilão para adicionar.",

    emailHeading: "Alterar e-mail",
    emailSubtext:
      "Tanto seu e-mail atual quanto o novo precisam confirmar antes da troca. Enviaremos um link para cada um.",
    emailNewLabel: "Novo e-mail",
    emailRequestChange: "Solicitar alteração",
    emailRequestPending:
      "Pendente — confira os dois e-mails pelo link de confirmação.",
    emailCancelChange: "Cancelar alteração pendente",

    deleteHeading: "Encerrar conta",
    deleteSubtext:
      "Encerra sua conta Kalki nos três jogos. Reflexão de 30 dias — entre antes desse prazo para cancelar.",
    deleteConfirmLabel: "Digite DELETE para confirmar",
    deleteButton: "Encerrar minha conta",
    dataExport: "Baixar meus dados",
    dataExportSubtext:
      "Exportação GDPR da sua conta, histórico da carteira e lances em JSON.",

    rgHeading: "Jogo responsável",
    rgSubtext:
      "Defina limites de aposta. Limites podem ser reduzidos imediatamente; aumentar requer 24h de espera.",
    rgCooldown: "Tirar uma pausa",
    rgSelfExclude: "Auto-excluir",
    rgWeeklyLimit: "Limite semanal",
    rgDailyLimit: "Limite diário",
    rgSessionLimit: "Limite por sessão",
    rgHelpline:
      "Se precisar de ajuda, ligue 1800-599-0019 (KIRAN — linha de saúde mental, Índia).",
  },

  notifications: {
    heading: "Notificações",
    subtext:
      "Atualizações de pedido, status de lance, respostas de suporte e recompensas.",
    unreadCount: "{count} não lidas",
    allRead: "Tudo lido.",
    markAllRead: "Marcar tudo como lido",
    emptyState:
      "Você está em dia. Dê um lance para começar a receber notificações.",
    preferencesHeading: "Preferências de notificação",
    preferencesEmail: "Receber e-mails sobre",
    preferencesPush: "Notificações push",
  },

  share: {
    button: "Compartilhar",
    copied: "Copiado",
    shared: "Compartilhado.",
    linkCopied: "Link copiado para a área de transferência.",
    couldntCopy:
      "Não foi possível copiar — seu navegador bloqueou o acesso à área de transferência.",
    ariaLabel: "Compartilhar este leilão",
  },

  errors: {
    genericNetwork: "Erro de rede. Tente de novo.",
    signedOut: "Faça login.",
    notFound: "Página não encontrada",
    notFoundDescription:
      "A página que você procura não existe ou foi movida.",
    backHome: "Voltar para o início",
    generic: "Algo deu errado.",
    unauthorized: "Faça login.",
    forbidden: "Você não tem acesso a esta página.",
    serverError: "Erro no servidor. Tente novamente em instantes.",
  },

  toast: {
    saved: "Salvo.",
    copied: "Copiado.",
    error: "Algo deu errado.",
    submitted: "Enviado.",
  },

  topup: {
    label: "Recarregar",
    coinsLabel: "moedas",
    open: "Abrir carteira",
  },
};

export default pt;

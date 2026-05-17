package com.uniquebid.app.ui.navigation

sealed class Route(val path: String) {
    data object Splash : Route("splash")
    data object Login : Route("login")
    data object Register : Route("register")
    data object Hub : Route("hub")
    // All three game surfaces are now WebViews of their respective Next.js
    // apps (Auctions + Bet on :3100, Aviator on :3000). The native
    // AuctionDetail / Bid / Home / Winner routes were removed when the
    // auctions UI moved to the web at `${AUCTIONS_URL}` — keep this list
    // in lockstep with `UniqueBidNavGraph.kt`.
    data object Auctions : Route("auctions")
    data object Aviator : Route("aviator")
    data object Bet : Route("bet")
    data object Wallet : Route("wallet")
    data object Notifications : Route("notifications")
    data object Profile : Route("profile")
}

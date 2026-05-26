package com.uniquebid.app.ui.screens.hub

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.uniquebid.app.ui.components.buildHardenedWebView

/**
 * Hub surface — hosts the auctions web app's `/` route inside a
 * WebView (PR-ANDROID-WEBVIEW-LOGIN-HUB). Was previously a native
 * Compose grid of three colour-coded game cards (warm amber Live
 * Auctions, red/orange Aviator, blue Kalki Exchange) that drifted
 * visually from the production web hub.
 *
 * Aligns the Android shell with the same "thin shell, web product
 * surfaces" pattern as the three game screens (Auctions / Aviator
 * / Bet). One design system, one place to update, instant parity
 * with whatever the web team ships — including the cyan/indigo
 * landing redesign + scroll-back-and-highlight on the three game
 * cards (PR-LOGIN-V2 on the web side).
 *
 * Auth handoff
 * ============
 * The user reaches this screen only after the splash check found a
 * token in [TokenStore] (or after the WebView login captured one).
 * We pass it to the web side as a `?token=…` query param — the
 * auctions middleware's existing SSO bridge consumes that, writes
 * the `kalki_token` cookie, and 302-redirects to a clean `/` URL.
 * Mirrors `AuctionsWebViewModel`, `BetViewModel`, `AviatorViewModel`.
 *
 * Navigation callbacks
 * ====================
 * The previous native hub took `onLiveAuctions` / `onAviator` /
 * `onBet` / `onWallet` / `onNotifications` / `onProfile` callbacks
 * and wired each card tap to one of those nav-graph destinations.
 * In the WebView model those callbacks are unused — the web hub
 * surfaces all three games + nav as web routes. They remain in the
 * signature so the nav graph compiles unchanged; a follow-up can
 * trim them once we're sure no downstream code reads them.
 */
@Composable
fun HubScreen(
    @Suppress("UNUSED_PARAMETER") onLiveAuctions: () -> Unit,
    @Suppress("UNUSED_PARAMETER") onAviator: () -> Unit,
    @Suppress("UNUSED_PARAMETER") onBet: () -> Unit,
    @Suppress("UNUSED_PARAMETER") onWallet: () -> Unit,
    @Suppress("UNUSED_PARAMETER") onNotifications: () -> Unit,
    @Suppress("UNUSED_PARAMETER") onProfile: () -> Unit,
    viewModel: HubWebViewModel = hiltViewModel(),
) {
    val url = remember { viewModel.url() }

    // Swallow the back gesture inside the hub — popping the splash
    // back into view would just bounce the user right back here.
    // Native log-out is the only intended exit (handled elsewhere
    // via the web profile menu, which calls the API logout endpoint
    // and clears both cookies).
    BackHandler(enabled = true) { /* swallow */ }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF050608)),
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx -> buildHardenedWebView(ctx, url) },
        )
    }
}

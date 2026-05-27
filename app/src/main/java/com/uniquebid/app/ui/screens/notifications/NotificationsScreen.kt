package com.uniquebid.app.ui.screens.notifications

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.uniquebid.app.ui.components.buildHardenedWebView

/**
 * Notifications surface — hosts the auctions web app's
 * `/notifications` route inside a WebView (PR-ANDROID-WEBVIEW-PARITY).
 * Was previously a native Compose placeholder ("No notifications yet.")
 * that drifted from the production web notifications page.
 *
 * Aligns the Android shell with the same "thin shell, web product
 * surfaces" pattern as the three game screens (Auctions / Aviator /
 * Bet) and the now-WebView Login + Hub (PR-ANDROID-WEBVIEW-LOGIN-HUB).
 * One design system, one place to update, instant parity with whatever
 * the web team ships.
 *
 * Auth handoff
 * ============
 * The user reaches this screen only after the splash check found a
 * token in [TokenStore]. We pass it to the web side as a `?token=…`
 * query param — the auctions middleware's existing SSO bridge consumes
 * that, writes the `kalki_token` cookie, and 302-redirects to a clean
 * URL. Mirrors [com.uniquebid.app.ui.screens.hub.HubWebViewModel].
 *
 * Navigation callbacks
 * ====================
 * The web `/notifications` page sits inside the same web hub chrome
 * that links between Auctions / Aviator / Bet / Notifications /
 * Profile / Wallet — meaning in-app nav is handled by the web side.
 * `onBack` is preserved so the system back gesture still pops the
 * Android nav stack (back to the Hub WebView). `onWalletClick` is now
 * unused — the web hub has its own coin chip wired to the in-page
 * top-up flow; kept in the signature so the nav graph compiles
 * unchanged.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    onBack: () -> Unit,
    @Suppress("UNUSED_PARAMETER") onWalletClick: () -> Unit,
    viewModel: NotificationsWebViewModel = hiltViewModel(),
) {
    val url = remember { viewModel.url() }

    // See AuctionsWebScreen for why this is a Compose state, not a plain
    // `var` — the previous implementation captured the closure and the
    // back-button never saw the WebView's true history depth.
    val canGoBack = remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF07090E)),
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            "Notifications",
                            color = Color(0xFFF5F7FF),
                            fontWeight = FontWeight.Bold,
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Back",
                                tint = Color(0xFFF5F7FF),
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = Color.Transparent,
                    ),
                )
            },
        ) { inner ->
            AndroidView(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(inner),
                factory = { ctx -> buildHardenedWebView(ctx, url) },
                update = { view -> canGoBack.value = view.canGoBack() },
            )
        }

        // Mirrors the Auctions / Aviator / Bet behaviour: a back gesture
        // always pops back to the hub. `canGoBack` is captured here so
        // a follow-up can walk the WebView history if desired.
        BackHandler(enabled = true) {
            if (canGoBack.value) onBack() else onBack()
        }
    }
}

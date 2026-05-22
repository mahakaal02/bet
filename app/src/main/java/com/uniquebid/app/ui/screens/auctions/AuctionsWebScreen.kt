package com.uniquebid.app.ui.screens.auctions

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
 * Hosts the Auctions section (served by the Bet Next.js app at
 * `${BET_URL}/auctions`) in a WebView. Mirrors `BetScreen` and
 * `AviatorScreen` exactly — same JWT-via-query-param SSO hand-off,
 * same back-handling, same WebView config — so the three game
 * surfaces stay structurally identical and the Android shell stays
 * thin.
 *
 * The web side (Bet's `TokenBridge.tsx`) consumes the `?token=` query
 * parameter, posts it through NextAuth's `backend-jwt` credentials
 * provider, and lands the user on a session that carries
 * `backendUserId` so `placeBidAction` can mint a backend JWT and call
 * the auctions REST API as the right user. None of that ceremony lives
 * here — the WebView just opens the URL.
 *
 * WebView setup is in [com.uniquebid.app.ui.components.buildHardenedWebView]
 * (PR-ANDROID-STAY-LOGGED-IN). Per-screen overrides should go through
 * that builder, not here — the three game surfaces must stay aligned.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuctionsWebScreen(
    onBack: () -> Unit,
    viewModel: AuctionsWebViewModel = hiltViewModel(),
) {
    val url = remember { viewModel.url() }

    // `canGoBack` is a Compose state holder (was a plain `var` in
    // earlier versions). The plain var was captured by the
    // `BackHandler` closure on first composition and never read the
    // value written by the `update` lambda — meaning the back button
    // always saw `false` regardless of the WebView's actual history.
    // Switching to a State means the recomposition triggered by
    // setValue propagates the latest value into the closure.
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
                            "Live Auctions",
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

        // Mirrors the Bet/Aviator behaviour: a back gesture always pops to
        // the hub. We capture `canGoBack` so future versions can choose to
        // walk the WebView history instead, but for v1 the trip back is
        // one tap regardless of how deep the user navigated.
        BackHandler(enabled = true) {
            if (canGoBack.value) onBack() else onBack()
        }
    }
}

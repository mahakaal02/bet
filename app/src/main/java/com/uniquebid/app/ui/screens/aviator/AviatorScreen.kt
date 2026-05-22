package com.uniquebid.app.ui.screens.aviator

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
 * Hosts the Next.js Aviator app in a WebView. The JWT is appended to the URL
 * (`?token=…`) so the page's TokenBridge stores it and lands on the game
 * without a second login.
 *
 * WebView setup is in [com.uniquebid.app.ui.components.buildHardenedWebView]
 * (PR-ANDROID-STAY-LOGGED-IN).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AviatorScreen(
    onBack: () -> Unit,
    viewModel: AviatorViewModel = hiltViewModel(),
) {
    val url = remember { viewModel.url() }

    // See AuctionsWebScreen for why this is a Compose state, not a plain
    // `var` — the previous implementation captured the closure and the
    // back-button never saw the WebView's true history depth.
    val canGoBack = remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B1020)),
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            "Aviator",
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

        // Hardware back button: for now always pops out to the hub.
        // Slice 4 will plumb a `view.goBack()` bridge if we want
        // in-WebView nav; the canGoBack value is captured here in
        // anticipation of that change.
        BackHandler(enabled = true) {
            if (canGoBack.value) onBack() else onBack()
        }
    }
}

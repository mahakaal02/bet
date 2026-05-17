package com.uniquebid.app.ui.screens.aviator

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Hosts the Next.js Aviator app in a WebView. The JWT is appended to the URL
 * (`?token=…`) so the page's TokenBridge stores it and lands on the game
 * without a second login.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AviatorScreen(
    onBack: () -> Unit,
    viewModel: AviatorViewModel = hiltViewModel(),
) {
    val url = remember { viewModel.url() }

    // Cache the WebView so Compose recompositions don't reload it.
    var canGoBack = false

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
                factory = { ctx ->
                    @SuppressLint("SetJavaScriptEnabled")
                    WebView(ctx).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                        setBackgroundColor(android.graphics.Color.TRANSPARENT)
                        webViewClient = WebViewClient()
                        webChromeClient = WebChromeClient()
                        with(settings) {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            // Always re-fetch from the dev server so HMR
                            // updates land on the next entry.
                            cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
                        }
                        loadUrl(url)
                    }
                },
                update = { view ->
                    canGoBack = view.canGoBack()
                },
            )
        }

        // Hardware back button: navigate back inside the WebView if it has
        // history, otherwise pop the Compose nav stack.
        BackHandler(enabled = true) {
            if (canGoBack) {
                // Note: we don't have direct access to the WebView instance here;
                // for Slice 3 we just let popBackStack fire which exits the
                // WebView entirely. Slice 4 will plumb a goBack() bridge if
                // we want in-WebView nav.
                onBack()
            } else {
                onBack()
            }
        }
    }
}

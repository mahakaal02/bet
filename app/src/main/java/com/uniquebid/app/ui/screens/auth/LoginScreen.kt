package com.uniquebid.app.ui.screens.auth

import android.graphics.Bitmap
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.ui.components.WebSsoBridge
import com.uniquebid.app.ui.components.buildHardenedWebView

/**
 * Login surface — hosts the auctions web app's `/login` route inside
 * a WebView (PR-ANDROID-WEBVIEW-LOGIN-HUB). Was previously a native
 * Compose form (email + password fields, Material `OutlinedTextField`s,
 * "Sign in" Button) that drifted visually from the production web
 * login. The Android shell now follows the same "thin shell, web
 * product surfaces" pattern as the other game screens (Auctions /
 * Aviator / Bet) — one design system, one place to update, instant
 * parity with whatever the web team ships.
 *
 * Auth handoff
 * ============
 * The web side mints the JWT (password or Telegram OAuth) and writes
 * it to an HttpOnly `kalki_token` cookie. On every page-finished
 * event we pull that cookie out of the WebView's [CookieManager]
 * via [WebSsoBridge.extractToken] and, if it's there + we haven't
 * already triggered, stash it in the native [TokenStore] (so the
 * native shell's [com.uniquebid.app.data.network.AuthInterceptor]
 * can attach it to subsequent REST calls) and fire [onLoginSuccess]
 * so the nav graph moves to the Hub.
 *
 * The `onRegisterClick` callback is now unused — the web `/login`
 * page has Login + Sign-up tabs inside a single card, so there's no
 * native register screen to navigate to. Kept in the signature so
 * the nav graph wiring doesn't churn.
 */
@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    @Suppress("UNUSED_PARAMETER") onRegisterClick: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val url = remember { BuildConfig.AUCTIONS_LOGIN_URL }

    // Track whether we've already handed control to the nav graph so
    // we don't fire `onLoginSuccess` more than once even if the user
    // wiggles the WebView and `onPageFinished` runs again. Compose
    // state, not a plain `var`, so the closure sees the latest value
    // after recomposition.
    var loginTriggered by remember { mutableStateOf(false) }
    // Capture the latest reference to `onLoginSuccess` so the
    // `factory` closure (which runs once) can call the current
    // navigation handler. Without this, a recomposition that changed
    // the handler would still call the original — fine in practice
    // for this graph, but the indirection costs nothing.
    val onLoginSuccessNow by rememberUpdatedState(onLoginSuccess)

    LaunchedEffect(Unit) {
        // PR-ANDROID-LOGOUT-COOKIE-WIPE — on entry into the login
        // surface, clear any stale auctions-domain auth cookie so a
        // post-logout re-entry can't be silently re-authenticated
        // by a cookie the user thought they signed out of.
        WebSsoBridge.clearAuthCookies(listOf(authDomain(url)))
    }

    // Disable the system back gesture from leaving the login screen —
    // there's nowhere safe to go (we'd land on the splash, which
    // re-checks auth and bounces straight back here). Matches the
    // previous native LoginScreen which had no back affordance either.
    BackHandler(enabled = true) { /* swallow */ }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // Match the web design's near-black base while the
            // WebView paints (avoids a white-flash on slow networks).
            .background(Color(0xFF050608)),
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                buildHardenedWebView(ctx, url).apply {
                    webViewClient = object : WebViewClient() {
                        override fun onRenderProcessGone(
                            view: WebView,
                            detail: RenderProcessGoneDetail,
                        ): Boolean {
                            // Mirror HardenedWebView's policy — swallow
                            // so the host process survives. The caller
                            // can re-create the WebView on the next
                            // recomposition.
                            (view.parent as? android.view.ViewGroup)?.removeView(view)
                            view.destroy()
                            return true
                        }

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            super.onPageStarted(view, url, favicon)
                            // Cookies CAN be present at page-start
                            // (cookies set by an earlier 302 hop in
                            // the same navigation chain) — try here
                            // as well so the redirect from Telegram
                            // → callback → /  surfaces the token
                            // before the final page renders.
                            maybeCaptureToken(url, viewModel) {
                                if (!loginTriggered) {
                                    loginTriggered = true
                                    onLoginSuccessNow()
                                }
                            }
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            maybeCaptureToken(url, viewModel) {
                                if (!loginTriggered) {
                                    loginTriggered = true
                                    onLoginSuccessNow()
                                }
                            }
                        }
                    }
                }
            },
        )
    }
}

/**
 * Pull the `kalki_token` cookie for `url`. If a non-empty value is
 * found, persist it in the native [TokenStore] (via
 * [LoginViewModel.persistToken]) and invoke `onCaptured`.
 *
 * Idempotent — the ViewModel only writes if the value differs from
 * what's already in the store, so re-entry just re-confirms the
 * existing token.
 */
private fun maybeCaptureToken(
    url: String?,
    viewModel: LoginViewModel,
    onCaptured: () -> Unit,
) {
    if (url.isNullOrBlank()) return
    val token = WebSsoBridge.extractToken(url) ?: return
    viewModel.persistToken(token)
    onCaptured()
}

/**
 * Extract the scheme + host from a URL string for cookie operations.
 * Defensive — if parsing fails (unlikely for a build-config URL), we
 * fall back to the URL itself, which is still a valid `setCookie`
 * domain argument.
 */
private fun authDomain(url: String): String {
    return runCatching {
        val parsed = android.net.Uri.parse(url)
        val scheme = parsed.scheme ?: return@runCatching url
        val host = parsed.host ?: return@runCatching url
        "$scheme://$host"
    }.getOrDefault(url)
}

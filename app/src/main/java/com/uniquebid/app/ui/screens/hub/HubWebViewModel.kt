package com.uniquebid.app.ui.screens.hub

import androidx.lifecycle.ViewModel
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.data.auth.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * URL builder for the hub WebView (PR-ANDROID-WEBVIEW-LOGIN-HUB).
 * Hands the native JWT off to the auctions web app via `?token=…`;
 * the auctions middleware's SSO bridge consumes the param, writes
 * the `kalki_token` cookie, and 302-redirects to a clean `/` URL.
 *
 * Mirrors [com.uniquebid.app.ui.screens.auctions.AuctionsWebViewModel]
 * exactly so the three game-WebView screens + the hub WebView all
 * follow the same hand-off pattern. If the token is somehow empty
 * (race between splash auth-check and hub navigation, or the user
 * just logged out and the nav-graph is mid-transition), we open
 * the bare hub URL — the web side will redirect to `/login` and
 * the user re-authenticates.
 */
@HiltViewModel
class HubWebViewModel @Inject constructor(
    private val tokens: TokenStore,
) : ViewModel() {
    fun url(): String {
        val base = BuildConfig.AUCTIONS_HUB_URL.trimEnd('/')
        val token = tokens.currentToken().orEmpty()
        return if (token.isEmpty()) base else "$base/?token=$token"
    }
}

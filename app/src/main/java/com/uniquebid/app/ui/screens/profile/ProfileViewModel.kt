package com.uniquebid.app.ui.screens.profile

import androidx.lifecycle.ViewModel
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.data.auth.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * URL builder for the profile WebView (PR-ANDROID-WEBVIEW-PARITY).
 * Hands the native JWT off to the auctions web app's `/profile` page
 * via `?token=…`; the auctions middleware's SSO bridge consumes the
 * param, writes the `kalki_token` cookie, and 302-redirects to a
 * clean URL with the user's session established.
 *
 * Replaces the previous loading + user-profile-fetch + logout
 * orchestration — the web `/profile` page now renders identity, the
 * unified wallet balance, and the cross-app sign-out chain (clears
 * auctions cookie, then Bet, then Aviator localStorage, then lands at
 * `/login`). The native shell hosts the WebView and gets out of the
 * way.
 *
 * Mirrors [com.uniquebid.app.ui.screens.hub.HubWebViewModel] /
 * [com.uniquebid.app.ui.screens.auctions.AuctionsWebViewModel] exactly
 * so every WebView surface in the shell follows the same hand-off
 * pattern.
 */
@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val tokens: TokenStore,
) : ViewModel() {
    fun url(): String {
        val base = BuildConfig.AUCTIONS_HUB_URL.trimEnd('/')
        val token = tokens.currentToken().orEmpty()
        return if (token.isEmpty()) "$base/profile" else "$base/profile?token=$token"
    }
}

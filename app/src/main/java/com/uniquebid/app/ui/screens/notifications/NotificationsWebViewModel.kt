package com.uniquebid.app.ui.screens.notifications

import androidx.lifecycle.ViewModel
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.data.auth.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * URL builder for the notifications WebView (PR-ANDROID-WEBVIEW-PARITY).
 * Hands the native JWT off to the auctions web app's `/notifications`
 * page via `?token=…`; the auctions middleware's SSO bridge consumes
 * the param, writes the `kalki_token` cookie, and 302-redirects to a
 * clean URL with the user's session established.
 *
 * Mirrors [com.uniquebid.app.ui.screens.hub.HubWebViewModel] /
 * [com.uniquebid.app.ui.screens.auctions.AuctionsWebViewModel] exactly
 * so every WebView surface in the shell follows the same hand-off
 * pattern. If the token is empty (race between splash auth-check and
 * navigation, or the user just logged out), we open the bare URL —
 * the web side will redirect to `/login` and the user re-authenticates.
 */
@HiltViewModel
class NotificationsWebViewModel @Inject constructor(
    private val tokens: TokenStore,
) : ViewModel() {
    fun url(): String {
        val base = BuildConfig.AUCTIONS_HUB_URL.trimEnd('/')
        val token = tokens.currentToken().orEmpty()
        return if (token.isEmpty()) "$base/notifications" else "$base/notifications?token=$token"
    }
}

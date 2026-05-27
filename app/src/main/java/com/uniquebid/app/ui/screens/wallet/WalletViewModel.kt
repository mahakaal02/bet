package com.uniquebid.app.ui.screens.wallet

import androidx.lifecycle.ViewModel
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.data.auth.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * URL builder for the wallet WebView (PR-ANDROID-WEBVIEW-PARITY).
 *
 * NOTE — There is currently no `/me/topup` (or `/wallet`) page on the
 * auctions web app. The unified-wallet balance and any top-up actions
 * live on `/profile` instead, so we route the wallet entry to
 * `/profile` for now. TODO(PR-WALLET-TOPUP-PAGE): once the web team
 * ships a dedicated top-up surface (planned at `/me/topup` per the
 * UNIFIED_WALLET.md spec), switch the path here without touching the
 * Compose layer.
 *
 * Hands the native JWT off to the auctions web app via `?token=…`;
 * the auctions middleware's SSO bridge consumes the param, writes the
 * `kalki_token` cookie, and 302-redirects to a clean URL with the
 * user's session established.
 *
 * Mirrors [com.uniquebid.app.ui.screens.hub.HubWebViewModel] /
 * [com.uniquebid.app.ui.screens.auctions.AuctionsWebViewModel] exactly
 * so every WebView surface in the shell follows the same hand-off
 * pattern.
 */
@HiltViewModel
class WalletViewModel @Inject constructor(
    private val tokens: TokenStore,
) : ViewModel() {
    fun url(): String {
        val base = BuildConfig.AUCTIONS_HUB_URL.trimEnd('/')
        val token = tokens.currentToken().orEmpty()
        // TODO(PR-WALLET-TOPUP-PAGE): swap `/profile` for `/me/topup`
        // once the dedicated top-up page lands on the auctions web app.
        return if (token.isEmpty()) "$base/profile" else "$base/profile?token=$token"
    }
}

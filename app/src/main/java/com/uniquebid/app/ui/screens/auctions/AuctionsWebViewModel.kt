package com.uniquebid.app.ui.screens.auctions

import androidx.lifecycle.ViewModel
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.data.auth.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * URL builder for the auctions WebView. The JWT is appended as `?token=…`;
 * the Bet site's `TokenBridge` consumes it via NextAuth's `backend-jwt`
 * provider and lands the user on the auctions list with a session that
 * carries `backendUserId`, which is what server actions need to mint a
 * backend JWT and place bids on the user's behalf. Mirrors `BetViewModel`.
 */
@HiltViewModel
class AuctionsWebViewModel @Inject constructor(
    private val tokens: TokenStore,
) : ViewModel() {
    fun url(): String {
        val base = BuildConfig.AUCTIONS_URL.trimEnd('/')
        val token = tokens.currentToken().orEmpty()
        return if (token.isEmpty()) base else "$base?token=$token"
    }
}

package com.uniquebid.app.ui.screens.bet

import androidx.lifecycle.ViewModel
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.data.auth.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class BetViewModel @Inject constructor(
    private val tokens: TokenStore,
) : ViewModel() {
    /**
     * The URL the WebView should load. JWT is appended as `?token=…`; the
     * bet site's TokenBridge stores it (best-effort SSO hint) and lands on
     * the prediction-markets dashboard.
     */
    fun url(): String {
        val base = BuildConfig.BET_URL.trimEnd('/')
        val token = tokens.currentToken().orEmpty()
        return if (token.isEmpty()) base else "$base/?token=$token"
    }
}

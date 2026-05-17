package com.uniquebid.app.ui.screens.aviator

import androidx.lifecycle.ViewModel
import com.uniquebid.app.BuildConfig
import com.uniquebid.app.data.auth.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class AviatorViewModel @Inject constructor(
    private val tokens: TokenStore,
) : ViewModel() {
    /**
     * The URL the WebView should load. JWT is appended as `?token=…`; the
     * Next.js page's TokenBridge stores it and lands on the game.
     */
    fun url(): String {
        val base = BuildConfig.AVIATOR_URL.trimEnd('/')
        val token = tokens.currentToken().orEmpty()
        return if (token.isEmpty()) base else "$base/?token=$token"
    }
}

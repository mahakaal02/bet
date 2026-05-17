package com.uniquebid.app.data.auth

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Synchronous JWT storage. SharedPreferences is used (not DataStore) so the
 * OkHttp [com.uniquebid.app.data.network.AuthInterceptor] can read the
 * current token without suspending on every request.
 *
 * Production note: swap the prefs file for EncryptedSharedPreferences when
 * payments / refresh-tokens land. Out of scope for Slice 2.
 */
@Singleton
class TokenStore @Inject constructor(@ApplicationContext context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private val _token = MutableStateFlow(prefs.getString(KEY_TOKEN, null))
    val tokenFlow: StateFlow<String?> = _token.asStateFlow()

    fun currentToken(): String? = _token.value

    fun setToken(token: String?) {
        _token.value = token
        prefs.edit().apply {
            if (token == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, token)
        }.apply()
    }

    fun clear() = setToken(null)

    companion object {
        private const val FILE = "uniquebid_auth"
        private const val KEY_TOKEN = "jwt"
    }
}

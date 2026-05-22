package com.uniquebid.app.ui.screens.splash

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.uniquebid.app.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import retrofit2.HttpException
import javax.inject.Inject

/**
 * Boot-time auth resolver.
 *
 * Policy (PR-ANDROID-STAY-LOGGED-IN):
 *
 *   - Stored token present + network reachable + `/auth/me` returns
 *     200  → go to Home (token confirmed valid by the server)
 *
 *   - Stored token present + `/auth/me` returns 401 → token is
 *     genuinely dead (revoked / signature mismatch / expired). Clear
 *     the bearer and bounce to login.
 *
 *   - Stored token present + ANY other failure (network down, 5xx,
 *     timeout, DNS error, TLS handshake fail) → go to Home anyway.
 *     We TRUST the stored token until we have explicit server-side
 *     proof it's bad. A YouTube-style app does not log the user out
 *     because their wifi blinked.
 *
 *   - No stored token → straight to login.
 *
 * Was previously: any `Throwable` from `/auth/me` triggered logout
 * + bounce to login. Combined with `AuthInterceptor` also wiping on
 * any 401, a single transient network hiccup OR an unrelated 401
 * from a different endpoint could silently sign the user out
 * mid-session.
 */
@HiltViewModel
class SplashViewModel @Inject constructor(
    private val auth: AuthRepository,
) : ViewModel() {

    fun resolveAuth(onAuthed: () -> Unit, onUnauthed: () -> Unit) {
        if (!auth.isAuthenticated()) {
            onUnauthed()
            return
        }
        viewModelScope.launch {
            try {
                auth.me()
                onAuthed()
            } catch (e: HttpException) {
                if (e.code() == 401) {
                    // Server says the token is dead. Clear + bounce.
                    Log.i(TAG, "/auth/me returned 401 — clearing bearer and routing to login")
                    auth.logout()
                    onUnauthed()
                } else {
                    // Some other HTTP error (5xx, 502 during deploy,
                    // 400 from a malformed request, etc.). Not a
                    // session-validity signal — keep the user signed
                    // in and let them try the app.
                    Log.w(TAG, "/auth/me returned ${e.code()} — staying signed in")
                    onAuthed()
                }
            } catch (t: Throwable) {
                // Network down, DNS error, TLS handshake failure,
                // timeout, etc. None of these say "your token is bad",
                // they say "we couldn't ask the server right now".
                // Trust the stored token and proceed; the in-app
                // screens will surface their own errors if the
                // network is still down when they fetch.
                Log.w(TAG, "/auth/me failed (offline / transient): ${t.message} — staying signed in")
                onAuthed()
            }
        }
    }

    companion object {
        private const val TAG = "SplashViewModel"
    }
}

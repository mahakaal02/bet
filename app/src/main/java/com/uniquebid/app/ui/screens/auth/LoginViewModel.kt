package com.uniquebid.app.ui.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.uniquebid.app.data.auth.TokenStore
import com.uniquebid.app.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import retrofit2.HttpException
import javax.inject.Inject

/**
 * Login screen view-model — used to drive a native Compose form, now
 * exists only to bridge the WebView-based login back into the native
 * shell's auth state (PR-ANDROID-WEBVIEW-LOGIN-HUB).
 *
 * `LoginScreen` is now a WebView pointed at the auctions web app's
 * `/login` route. The web side mints the JWT (password or Telegram
 * OAuth) and writes a `kalki_token` cookie. The WebView client
 * extracts that cookie via `WebSsoBridge` on every page-finished
 * event and hands it here via [persistToken] — we copy it into the
 * native [TokenStore] so the OkHttp `AuthInterceptor` can attach it
 * to native REST calls (wallet, leaderboards, etc.) and the splash
 * screen's `isAuthenticated()` check sees the live session on
 * subsequent app launches.
 *
 * The legacy `email` / `password` / `submit` flow was removed:
 * email+password sign-in still works, but it happens entirely on
 * the web. Keeping the LoginViewModel scoped to this single bridge
 * method removes the duplicate code path AND eliminates the
 * possibility of the two implementations drifting.
 *
 * AuthRepository is still injected (not directly consumed today)
 * because the same DI graph powers a planned follow-up: pre-flight
 * `/auth/me` after persisting the token so the native shell can
 * cache the user profile + coin balance before the user navigates
 * away from the WebView.
 */
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val tokens: TokenStore,
    @Suppress("unused") private val auth: AuthRepository,
) : ViewModel() {

    /**
     * Persist a JWT captured from the WebView's session cookie into
     * the native [TokenStore]. Idempotent — repeated calls with the
     * same value are no-ops at the store level (it diffs before
     * writing to the encrypted SharedPreferences).
     */
    fun persistToken(token: String) {
        if (token.isBlank()) return
        if (tokens.currentToken() == token) return
        tokens.setToken(token)
    }

    /**
     * Best-effort post-login hydration. The WebView captures the
     * JWT; we then ask the backend for the live user profile so the
     * native shell's CoinBalanceStore is fresh before the user lands
     * on the hub.
     *
     * NOT called today — kept as a hook for a follow-up that wants
     * to surface the user's coin balance in the native chrome
     * immediately after login without waiting for the next hub
     * refresh. Failures are silent (network-only).
     */
    @Suppress("unused")
    fun hydrateProfile() {
        viewModelScope.launch {
            try {
                auth.me()
            } catch (_: HttpException) { /* ignore — splash will retry */ }
            catch (_: Throwable) { /* offline — ignore */ }
        }
    }
}

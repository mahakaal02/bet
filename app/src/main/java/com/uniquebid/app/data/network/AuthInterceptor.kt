package com.uniquebid.app.data.network

import com.uniquebid.app.data.auth.TokenStore
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp interceptor that attaches the stored bearer JWT to every
 * outbound request. Pure header-injection — does NOT make session
 * policy decisions.
 *
 * History — PR-ANDROID-STAY-LOGGED-IN:
 *   The previous version called `tokens.clear()` whenever ANY response
 *   came back as 401 with a token present. That single line was the
 *   leading cause of "I randomly got logged out" reports: any transient
 *   401 from any endpoint (an unrelated WS auth race, a stale-token
 *   blip during deploy, even a server bug returning the wrong status
 *   for an unrelated reason) would silently wipe the user's session.
 *
 *   The platform expectation now is YouTube/Zoom-style persistence:
 *   the user stays signed-in indefinitely until they explicitly tap
 *   "Sign out" — even across app restarts, even after a 401 from a
 *   non-auth endpoint. Token wiping is now a deliberate decision made
 *   by:
 *     - [com.uniquebid.app.data.repository.AuthRepository.logout] when
 *       the user explicitly signs out
 *     - [com.uniquebid.app.ui.screens.splash.SplashViewModel] only
 *       when `/auth/me` returns a genuine 401 (token revoked / expired)
 *
 *   Other 401s flow through to the caller untouched. The screen layer
 *   surfaces them as in-context errors (e.g. "couldn't load balance,
 *   try again") instead of nuking the session.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokens: TokenStore,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val token = tokens.currentToken()
        val authed = if (token != null) {
            req.newBuilder().header("Authorization", "Bearer $token").build()
        } else {
            req
        }
        return chain.proceed(authed)
    }
}

package com.uniquebid.app.ui.components

import android.webkit.CookieManager

/**
 * Glue between the auctions web app's session cookie and the native
 * [com.uniquebid.app.data.auth.TokenStore].
 *
 * The web side mints the JWT — for password sign-in it's the response
 * of `POST /api/auth/login`; for Telegram OAuth it's the redirect
 * back from `oauth.telegram.org` through
 * `/api/auth/telegram/callback`. Either way, the value lands in an
 * HttpOnly cookie named `kalki_token`. Setting `httpOnly=true` is
 * the right thing on the WEB (XSS can't read the value), but on
 * Android we explicitly want to pull the token out of the WebView
 * cookie jar and stash it in the native TokenStore so the
 * `AuthInterceptor` can attach it to every subsequent REST call
 * the native shell makes (wallet top-up, leaderboards, etc.).
 *
 * The Android `CookieManager` reads ALL cookies regardless of the
 * HttpOnly flag — that flag only gates *JavaScript* `document.cookie`
 * access. Reading via [CookieManager.getCookie] from native code is
 * always allowed. So we don't need to drop HttpOnly on the web side
 * just to make the bridge work.
 */
object WebSsoBridge {
    private const val COOKIE_NAME = "kalki_token"

    /**
     * Pull the `kalki_token` value out of the WebView's cookie jar for
     * the given URL, if present. Returns `null` when the cookie is
     * absent or blank (typical pre-login state).
     *
     * Safe to call any time — the underlying [CookieManager] is a
     * process-wide singleton that does not require a live WebView.
     */
    fun extractToken(url: String): String? {
        val raw = CookieManager.getInstance().getCookie(url) ?: return null
        // `getCookie` returns the Cookie-header style string
        // ("a=1; b=2; kalki_token=eyJhbGc…"). Split on ';', find the
        // entry whose key is exactly `kalki_token` (NOT a prefix match —
        // `kalki_token_csrf` would otherwise hit), trim, return the
        // value side.
        for (entry in raw.split(';')) {
            val trimmed = entry.trim()
            val eq = trimmed.indexOf('=')
            if (eq <= 0) continue
            val key = trimmed.substring(0, eq)
            if (key == COOKIE_NAME) {
                val value = trimmed.substring(eq + 1).trim()
                return value.ifBlank { null }
            }
        }
        return null
    }

    /**
     * Clear the kalki_token cookie from the WebView jar. Called on
     * native-side logout so re-opening the login WebView doesn't
     * silently re-establish the stale session.
     *
     * Uses the modern async API where available (API 21+ — well below
     * our `minSdk = 26`).
     */
    fun clearAuthCookies(domains: List<String>) {
        val mgr = CookieManager.getInstance()
        for (domain in domains) {
            // Setting an empty value with `Max-Age=0` is the documented
            // way to delete a cookie. `removeAllCookies` is too
            // aggressive — it would also drop locale prefs and other
            // non-auth cookies the user shouldn't lose.
            mgr.setCookie(domain, "$COOKIE_NAME=; Path=/; Max-Age=0")
        }
        mgr.flush()
    }
}

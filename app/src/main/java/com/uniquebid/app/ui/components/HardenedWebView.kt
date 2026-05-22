package com.uniquebid.app.ui.components

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Single source of truth for how the Kalki Android shell builds its
 * embedded WebViews. The three game screens (Auctions / Aviator / Bet)
 * all wrap their Next.js apps in a WebView and used to duplicate ~25
 * lines of identical setup each, with subtle drift between copies
 * (one had `LOAD_NO_CACHE`, one didn't override `onRenderProcessGone`,
 * etc.). Now they all funnel through this builder.
 *
 * Hardening applied (PR-ANDROID-STAY-LOGGED-IN):
 *
 * 1. **`cacheMode = LOAD_DEFAULT`** (was `LOAD_NO_CACHE`). The old
 *    setting forced the WebView to re-fetch every asset — JS bundles,
 *    images, leaderboard rows — on every recomposition AND on every
 *    scroll-triggered relayout. On a long leaderboard with avatars
 *    this thrashed the render-process memory until the system OOM-
 *    killed it. `LOAD_DEFAULT` honours standard HTTP caching, which
 *    is what every web client does. The "always re-fetch for HMR"
 *    note that justified LOAD_NO_CACHE was a dev-time convenience
 *    that should never have shipped to release.
 *
 * 2. **`onRenderProcessGone` override.** Without this, when the
 *    render process is killed for any reason (OOM, system reclaim,
 *    crash), the default behaviour is to crash the host process too.
 *    Now we swallow the death, remove the dead WebView, and let the
 *    caller reload. Returning `true` is the documented signal that
 *    "I've handled the death, don't kill me too."
 *
 * 3. **`OverScrollMode = OVER_SCROLL_NEVER`**. The default elastic
 *    overscroll bounce re-triggers a relayout every time the user
 *    scrolls past the edge — fine on a small page, expensive on a
 *    long leaderboard. Disabling the bounce trades a small UX flair
 *    for measurable scroll stability.
 *
 * 4. **`setLayerType(LAYER_TYPE_HARDWARE)`** — explicit opt-in to
 *    GPU-backed layer rendering. The manifest now sets
 *    `android:hardwareAccelerated="true"` globally, but a per-view
 *    declaration here is belt-and-braces for OEMs that quietly
 *    flip the manifest flag back to software for unsigned APKs.
 *
 * 5. **`mediaPlaybackRequiresUserGesture = false`** so the in-WebView
 *    Aviator countdown audio (if added later) doesn't get muted.
 *
 * 6. **DOM + database storage on**, matching what the three Next.js
 *    apps assume.
 *
 * Compose [androidx.compose.ui.viewinterop.AndroidView] callers should
 * pass this view straight into `factory = { buildHardenedWebView(it, url) }`.
 */
@SuppressLint("SetJavaScriptEnabled")
fun buildHardenedWebView(context: Context, url: String): WebView {
    return WebView(context).apply {
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        setBackgroundColor(android.graphics.Color.TRANSPARENT)
        overScrollMode = View.OVER_SCROLL_NEVER
        setLayerType(View.LAYER_TYPE_HARDWARE, null)

        webChromeClient = WebChromeClient()
        webViewClient = object : WebViewClient() {
            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail,
            ): Boolean {
                Log.w(
                    TAG,
                    "WebView render process gone (didCrash=${detail.didCrash()}) — " +
                        "swallowing to keep host process alive",
                )
                // Detach the dead WebView from its parent so it doesn't
                // try to render again. The caller can re-create on the
                // next recomposition; without this the host process
                // would also die (Android's default behaviour).
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                return true
            }
        }

        with(settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // Honour the standard HTTP cache. Was LOAD_NO_CACHE
            // historically — see the class comment for why that's
            // the wrong default in production.
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        loadUrl(url)
    }
}

private const val TAG = "HardenedWebView"

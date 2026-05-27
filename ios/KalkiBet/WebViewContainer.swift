import SwiftUI
import WebKit
import os.log

/// `UIViewRepresentable` wrapper around `WKWebView`. This is the iOS
/// equivalent of the Android `HardenedWebView` builder + the
/// `WebSsoBridge` cookie extractor combined — kept in one file because
/// SwiftUI's representable pattern wants a single struct that owns both
/// the view config and the delegate plumbing.
///
/// Responsibilities:
///   1. Load the URL passed in via the initializer.
///   2. On every navigation completion, inspect the `WKHTTPCookieStore`
///      for a cookie named `kalki_token`. If found AND it differs from
///      what `SessionStore` already holds, persist it via
///      `SessionStore.shared.set(token:)`. This is the iOS equivalent
///      of Android's `WebSsoBridge.extractToken` on `onPageFinished`
///      (see `app/src/main/java/com/uniquebid/app/ui/components/WebSsoBridge.kt`).
///
/// Cookie-store note: `WKHTTPCookieStore` (the *web-view* cookie jar)
/// is separate from `HTTPCookieStorage.shared` (the URLSession cookie
/// jar). The auctions hub writes its `kalki_token` to the WKWebView
/// jar via the page's `Set-Cookie` response header, so that's what we
/// query here. We do NOT mirror the cookie into URLSession because
/// this shell makes no native REST calls — every API hit happens
/// inside the WebView. If a future PR adds native REST (e.g. for
/// push-notification registration), it should add an `HTTPCookieStorage`
/// or `Authorization: Bearer` mirror at that point.
struct WebViewContainer: UIViewRepresentable {

    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        // Inline preferences are configured via `defaultWebpagePreferences`
        // on the configuration rather than the deprecated
        // `WKPreferences.javaScriptEnabled`. JS is on by default in
        // `defaultWebpagePreferences`, but we set it explicitly so
        // the intent is visible at the call site.
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true

        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences = prefs
        // Aviator-style media (countdown beeps, win sound) should play
        // without requiring an explicit tap. Mirrors Android's
        // `settings.mediaPlaybackRequiresUserGesture = false`.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        // The auctions hub is a single web product; use the default
        // (persistent) data store so cookies survive between launches.
        // `WKWebsiteDataStore.default()` is the same jar
        // `Coordinator.captureToken` queries below — keep them aligned.
        configuration.websiteDataStore = WKWebsiteDataStore.default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        // Match the web design's near-black base so slow networks
        // don't flash white between WebView creation and first paint.
        // `isOpaque = false` + `backgroundColor` is the documented
        // way to set the underlay; setting only `backgroundColor`
        // leaves the default white showing through.
        webView.isOpaque = false
        webView.backgroundColor = UIColor(
            red: 0.02,
            green: 0.024,
            blue: 0.031,
            alpha: 1.0
        )
        webView.scrollView.backgroundColor = webView.backgroundColor

        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // No-op: this shell only ever passes one URL per WebView
        // instance. If the parent view changes the URL, SwiftUI will
        // tear down and re-create the container — which is what we
        // want (clean cookie-extraction state, fresh navigation
        // delegate). Loading inside `updateUIView` would risk
        // re-loading every recomposition.
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKNavigationDelegate {

        private static let cookieName = "kalki_token"
        private static let logger = Logger(
            subsystem: "com.kalki.bet",
            category: "WebViewContainer"
        )

        // Track the last token we successfully wrote so we don't
        // hammer the Keychain on every page-finished (typical SPA
        // navigation fires `didFinish` multiple times per route
        // change). Matches the Android `LoginScreen.loginTriggered`
        // + `LoginViewModel.persistToken` idempotency pair.
        private var lastWrittenToken: String?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            captureToken(from: webView)
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            // Cookies CAN be present at commit-time (set by an earlier
            // 302 hop in the same navigation chain — e.g. the Telegram
            // OAuth callback redirects to `/?` and the `Set-Cookie`
            // lands on the redirect, not the final page). Mirrors the
            // Android LoginScreen's `onPageStarted` + `onPageFinished`
            // double-check.
            captureToken(from: webView)
        }

        /// Async cookie inspection. `getAllCookies` is callback-based
        /// (no async variant on older iOS versions), so we wrap the
        /// closure body in a guard-self check to avoid retain cycles
        /// on view teardown.
        private func captureToken(from webView: WKWebView) {
            let cookieStore = webView.configuration.websiteDataStore.httpCookieStore
            cookieStore.getAllCookies { [weak self] cookies in
                guard let self = self else { return }
                guard let cookie = cookies.first(where: { $0.name == Self.cookieName }) else {
                    return
                }
                let value = cookie.value.trimmingCharacters(in: .whitespaces)
                guard !value.isEmpty else { return }

                // Skip if we just wrote this value — avoids redundant
                // Keychain churn on multi-fire `didFinish`.
                if self.lastWrittenToken == value {
                    return
                }
                // Skip if the store already has it (e.g. cold start
                // where we passed the token in via query param and
                // the web responded with the same cookie).
                if SessionStore.shared.currentToken() == value {
                    self.lastWrittenToken = value
                    return
                }

                SessionStore.shared.set(token: value)
                self.lastWrittenToken = value
                Self.logger.info("Captured kalki_token from WebView cookie jar; persisted to SessionStore")
            }
        }
    }
}

import SwiftUI

/// Root surface — mirrors the Android nav graph's
/// `splash → login | hub` decision tree (see
/// `app/src/main/java/com/uniquebid/app/ui/navigation/UniqueBidNavGraph.kt`).
///
/// Flow:
///   1. Show a brief splash (`Kalki Bet` wordmark on the dark base)
///      for ~700ms — same dwell time as the Android `SplashScreen`'s
///      `LaunchedEffect(Unit) { delay(700) }`. The dwell exists so the
///      first paint is the brand, not a half-loaded WebView, on cold
///      starts where the network roundtrip would otherwise be visible.
///   2. While the splash is up, read the JWT (if any) from
///      `SessionStore` (Keychain).
///   3. After 700ms swap to `WebViewContainer`:
///        - token present → `https://kalki-auctions.cloud.podstack.ai/?token=<jwt>`
///          (the auctions hub honours this query param via its SSO
///          bridge so the WebView lands authenticated on first paint).
///        - token absent  → `https://kalki-auctions.cloud.podstack.ai/login`
///          (the web side handles password + Telegram OAuth, sets the
///          `kalki_token` HttpOnly cookie; `WebViewContainer` then
///          extracts that cookie into `SessionStore`).
///
/// The whole tree sits on `Color(red: 0.02, green: 0.024, blue: 0.031)`
/// — that's `#050608`, the web design's base. Painting it as the
/// `RootView` background means there's no white flash if the WebView
/// is slow to first-paint.
struct RootView: View {

    /// Base auctions hub URL. Hardcoded — the Android shell parameterises
    /// this through `BuildConfig.AUCTIONS_LOGIN_URL` because it varies
    /// between debug/release builds, but the iOS shell only ships against
    /// production, and Xcode scheme-level config can override this later
    /// if a staging build target is added.
    private static let hubBaseURL = "https://kalki-auctions.cloud.podstack.ai"

    /// Splash dwell in seconds. Matches Android's `delay(700)`.
    private static let splashDwell: TimeInterval = 0.7

    /// Web design base — `#050608`. Re-declared here (rather than
    /// importing a theme module) because this shell has exactly one
    /// colour and pulling in a whole theme layer for it would be
    /// overkill.
    private static let baseBackground = Color(
        red: 0.02,
        green: 0.024,
        blue: 0.031
    )

    @State private var showSplash: Bool = true
    @State private var targetURL: URL?

    var body: some View {
        ZStack {
            Self.baseBackground
                .ignoresSafeArea()

            if showSplash {
                splashContent
                    .transition(.opacity)
            } else if let url = targetURL {
                WebViewContainer(url: url)
                    .ignoresSafeArea()
                    .transition(.opacity)
            } else {
                // Defensive fallback — if `targetURL` is somehow nil
                // after the splash dwell (URL construction failed for
                // a hardcoded valid string, which shouldn't happen),
                // keep the splash up rather than show a blank screen.
                splashContent
            }
        }
        .task {
            await bootstrap()
        }
    }

    private var splashContent: some View {
        VStack(spacing: 8) {
            Text("Kalki Bet")
                .font(.system(size: 48, weight: .bold, design: .default))
                .foregroundColor(.white)
                .padding(.horizontal, 24)
        }
    }

    /// Resolve the initial URL (based on Keychain state) and flip out
    /// of the splash after the dwell. Single-shot — driven by `.task`,
    /// which cancels if the view goes away mid-bootstrap.
    private func bootstrap() async {
        let url = resolveInitialURL()
        // Sleep for the splash dwell — `Task.sleep` is the SwiftUI
        // equivalent of `kotlinx.coroutines.delay`. 700ms in
        // nanoseconds = 700_000_000.
        try? await Task.sleep(nanoseconds: UInt64(Self.splashDwell * 1_000_000_000))
        await MainActor.run {
            self.targetURL = url
            withAnimation(.easeOut(duration: 0.2)) {
                self.showSplash = false
            }
        }
    }

    /// Decide which web URL to load based on whether the Keychain
    /// already holds a JWT. Equivalent to Android's
    /// `SplashViewModel.resolveAuth` branching.
    private func resolveInitialURL() -> URL? {
        if let token = SessionStore.shared.currentToken(), !token.isEmpty {
            // `URLQueryItem` handles percent-encoding for us so a JWT
            // with characters like `.` or `_` doesn't break the URL.
            var components = URLComponents(string: "\(Self.hubBaseURL)/")
            components?.queryItems = [URLQueryItem(name: "token", value: token)]
            return components?.url ?? URL(string: "\(Self.hubBaseURL)/")
        }
        return URL(string: "\(Self.hubBaseURL)/login")
    }
}

#Preview {
    RootView()
}

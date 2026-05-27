import SwiftUI

/// Top-level SwiftUI App entry — mirrors the Android `MainActivity` +
/// `UniqueBidApp` pair. Single `WindowGroup` hosting the root view.
///
/// The app is a thin native shell over the auctions hub web product at
/// `https://kalki-auctions.cloud.podstack.ai/`. All UI lives on the web;
/// this shell exists to (a) ship the experience through the App Store
/// and (b) provide Keychain-backed session persistence so the user
/// doesn't have to re-authenticate every cold start.
///
/// `preferredColorScheme(.dark)` is set globally so the system status
/// bar matches the web design's near-black base (`#050608`) and we
/// avoid the iOS-default white flash during WebView load on slow
/// networks. This is the iOS equivalent of the Compose
/// `Modifier.background(Color(0xFF050608))` wrapper used around the
/// Android WebViews.
@main
struct KalkiBetApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
    }
}

# Kalki Bet — iOS shell

A thin native iOS app that wraps the auctions hub web product at
`https://kalki-auctions.cloud.podstack.ai/` in a `WKWebView` and
adds Keychain-backed session persistence.

## Architecture

```
KalkiBetApp (SwiftUI @main)
    │
    └─ RootView
         │
         ├─ Splash (Kalki Bet wordmark, ~700ms)
         │
         ├─ token in Keychain → WebView at /?token=<jwt>     (SSO bridge → hub)
         │
         └─ no token        → WebView at /login              (web mints JWT)
                                  │
                                  ├─ user signs in (password / Telegram OAuth)
                                  ├─ web sets `kalki_token` HttpOnly cookie
                                  ├─ WKNavigationDelegate.didFinish reads
                                  │   WKHTTPCookieStore for that cookie
                                  └─ SessionStore.set(token:) → Keychain
```

All UI lives on the web. This shell exists to:
1. Ship the experience through the App Store / TestFlight.
2. Persist the JWT across cold starts via Keychain (Secure Enclave-backed),
   so the user doesn't re-authenticate every launch.

The Android counterpart in `app/` follows the same pattern post
PR-ANDROID-WEBVIEW-LOGIN-HUB (#108). Reference files for the equivalent
behaviour:
- `app/src/main/java/com/uniquebid/app/ui/screens/auth/LoginScreen.kt`
- `app/src/main/java/com/uniquebid/app/ui/components/WebSsoBridge.kt`
- `app/src/main/java/com/uniquebid/app/data/auth/TokenStore.kt`
- `app/src/main/java/com/uniquebid/app/ui/screens/splash/SplashScreen.kt`

## What's in this directory

```
ios/
├── .gitignore              # Standard Swift / Xcode ignores
├── README.md               # this file
└── KalkiBet/
    ├── KalkiBetApp.swift   # @main App entry, dark color scheme
    ├── RootView.swift      # Splash + URL routing
    ├── WebViewContainer.swift  # WKWebView wrapper + cookie bridge
    ├── SessionStore.swift  # Keychain wrapper (Android TokenStore parity)
    ├── Info.plist          # Bundle metadata
    └── Assets.xcassets/    # Empty — you add the app icon
```

The `.xcodeproj` is intentionally **not** in the repo. It's tied to your
Apple Team ID and bundle identifier, so we generate it locally instead
of dragging team-specific config through git. (You'd have to edit it
on every clone anyway, and `.xcodeproj` files diff terribly.)

## First-time setup runbook

### 1. Generate the Xcode project

Open Xcode → **File → New → Project** → **iOS** → **App**.

Settings:
- **Product Name**: `KalkiBet`
- **Team**: your Apple Developer account
- **Organization Identifier**: `com.kalki.bet` (or whatever your team uses)
- **Bundle Identifier**: should resolve to `com.kalki.bet.KalkiBet`
- **Interface**: SwiftUI
- **Language**: Swift
- **Storage**: None
- **Include Tests**: optional (the shell has nothing to unit-test)
- **Minimum Deployment**: iOS 16.0 (matches Android `minSdk = 26` parity)

Save the project somewhere **outside this repo** (e.g. `~/Developer/KalkiBet-xcode/`).
We're only using Xcode to produce the project file; the source lives here.

### 2. Replace Xcode's generated source with this repo's

In the new Xcode project, delete the auto-generated files:
- `KalkiBetApp.swift`
- `ContentView.swift`
- `Info.plist` (only if Xcode created a standalone one — newer Xcode
  versions inline it into project settings; in that case skip this and
  configure via the **Info** tab instead)

Then drag-and-drop the contents of `ios/KalkiBet/` from this repo into
the Xcode project navigator. When prompted:
- **Copy items if needed**: yes
- **Create groups**: yes
- **Add to targets**: KalkiBet

Files to drop:
- `KalkiBetApp.swift`
- `RootView.swift`
- `WebViewContainer.swift`
- `SessionStore.swift`
- `Info.plist` (only if you deleted the generated one)
- `Assets.xcassets/` (replace the generated empty one)

### 3. Wire signing & capabilities

**Project Settings → Signing & Capabilities**:
- **Team**: your Apple Developer team
- **Bundle Identifier**: `com.kalki.bet.KalkiBet` (or your chosen value;
  must be registered in the [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list)
  before you can submit to TestFlight)
- **Signing**: Automatic
- **Capabilities**: none needed for v1. Add Push Notifications later if
  you wire APNs.

### 4. Run on simulator

`Cmd-R` (Product → Run). You should see:
1. ~700ms splash with "Kalki Bet" wordmark on the dark base.
2. WebView loading `https://kalki-auctions.cloud.podstack.ai/login`.
3. Sign in via Telegram or password → the WebView navigates to the hub.
4. Force-quit and relaunch → splash → directly to the hub (Keychain
   replayed the JWT via `?token=` query param to the SSO bridge).

### 5. Add the app icon

Open `Assets.xcassets` → **AppIcon** → drop in the 1024×1024 marketing
icon. Xcode generates the rest of the size set automatically (or use the
Bakery / IconKit workflow if you want pre-rendered assets per size).

### 6. Archive + TestFlight

**Product → Archive** → wait for the archive to build → **Distribute
App** → **App Store Connect** → **Upload**.

Before TestFlight can ingest the build:
- The bundle identifier must be registered in
  [App Store Connect → Apps](https://appstoreconnect.apple.com/apps).
- The app icon must include all required sizes (Xcode warns if any are
  missing).
- Version + build numbers must be unique per upload. The shipped
  `Info.plist` starts at `CFBundleShortVersionString = 1.0` /
  `CFBundleVersion = 1` — bump `CFBundleVersion` for every TestFlight
  upload (App Store Connect rejects duplicates).

### 7. Heads-up before TestFlight

- **Bundle ID must be registered** in the Apple Developer Portal
  *before* the first archive upload — App Store Connect won't create
  the app record otherwise. Provisioning is automatic once the ID exists.
- **Export Compliance**: TestFlight asks whether the app uses
  encryption. The Keychain APIs count as standard system encryption
  (exempt), so answer **"No — exempt under category 5D992.c"**. If you
  later add custom crypto, you'll need to file an ERN.
- **App Tracking Transparency**: the shell does no tracking. If web
  pages inside the WebView do, that's on the web product to disclose,
  not the iOS shell.
- **Camera / Photos / Mic permissions**: not requested in the current
  `Info.plist`. The WebView WILL prompt for them if the web product
  asks for media; add the `NS*UsageDescription` keys to `Info.plist`
  the first time you wire KYC photo upload or voice features.

## Updating the source

The four `.swift` files in `ios/KalkiBet/` are the source of truth. If
you edit them in Xcode, copy the changes back into this directory and
commit. Xcode will read them fresh on the next build via the file
references created in step 2 (since you chose **Create groups**, not
**Folder references**).

If you find yourself editing this repo's copy by hand outside of Xcode,
make sure the Xcode project's file references still point at this
directory — they do as long as the relative path from the `.xcodeproj`
to the source files hasn't changed.

## Verifying parity with Android

When the web team ships a change to the auctions hub, both shells pick
it up automatically — they're just WebView wrappers. The native code
in either shell only needs to change when the *session bridge* changes:

| Change                                          | iOS file                | Android file                                   |
|-------------------------------------------------|-------------------------|------------------------------------------------|
| Cookie name changes from `kalki_token`          | `WebViewContainer.swift` (`cookieName`) | `WebSsoBridge.kt` (`COOKIE_NAME`) |
| Hub URL changes                                 | `RootView.swift` (`hubBaseURL`) | `BuildConfig.AUCTIONS_LOGIN_URL` |
| Storage rotates (e.g. wallet PIN added)         | `SessionStore.swift`    | `TokenStore.kt`                                |
| Splash dwell changes                            | `RootView.swift` (`splashDwell`) | `SplashScreen.kt` (`delay(700)`)        |

Keep this table aligned when the web team renames anything.

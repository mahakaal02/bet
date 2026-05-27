import Foundation
import Security
import os.log

/// JWT storage backed by the iOS Keychain. Mirrors the Android
/// `TokenStore` API (see
/// `app/src/main/java/com/uniquebid/app/data/auth/TokenStore.kt`):
///
///   - `currentToken() -> String?`
///   - `set(token:)` — idempotent (no-op if value matches what's already
///     stored)
///   - `clear()`
///
/// Why Keychain (not `UserDefaults`):
///   - The bearer JWT is the only thing standing between an attacker
///     with physical device access and a user's wallet. `UserDefaults`
///     lives in a plist inside the app sandbox — readable by anyone
///     with a jailbreak, an iTunes backup, or device-class debugging.
///   - The Keychain wraps the value in the Secure Enclave-backed
///     encrypted store with `kSecAttrAccessibleAfterFirstUnlock` so
///     it survives reboots but is inaccessible before the device
///     unlock that follows a power-cycle. Equivalent security posture
///     to Android's `EncryptedSharedPreferences` (AES-256-GCM with a
///     hardware-sealed master key).
///
/// Failure fallback: if `SecItemAdd`/`SecItemCopyMatching` returns a
/// non-success status for any reason (simulator quirks, corrupted
/// keychain, sandbox issues during a TestFlight rotate), we degrade
/// to `UserDefaults` and log loudly via `os_log`. This mirrors the
/// Android `TokenStore` falling back to plaintext `SharedPreferences`
/// when `EncryptedSharedPreferences.create` throws. The user keeps
/// functioning; the operator sees the warning and knows to
/// investigate. The fallback is rare in practice — Keychain works on
/// every supported simulator and device.
final class SessionStore {

    static let shared = SessionStore()

    private static let service = "com.kalki.bet.session"
    private static let account = "kalki_token"
    private static let fallbackDefaultsKey = "com.kalki.bet.session.fallback.token"

    private static let logger = Logger(
        subsystem: "com.kalki.bet",
        category: "SessionStore"
    )

    // Serialise access so concurrent reads/writes from the WebView
    // delegate (background queue) and the splash bootstrap (main
    // actor) can't race. Keychain itself is thread-safe, but our
    // internal cached read + fallback path are not.
    private let queue = DispatchQueue(label: "com.kalki.bet.session.store")

    private init() {}

    // MARK: - Public API

    /// Returns the currently-stored JWT, or `nil` if none is set.
    func currentToken() -> String? {
        queue.sync {
            if let value = readKeychain() {
                return value
            }
            // If the keychain returned nil for "not found" we accept
            // that as the authoritative answer. The fallback is only
            // consulted when keychain throws — see `readKeychain`.
            return nil
        }
    }

    /// Stores the JWT. Idempotent: if `token` matches the value
    /// already on disk we skip the write so we don't churn the
    /// Keychain on multi-fire WebView delegate callbacks.
    func set(token: String) {
        queue.sync {
            if let existing = readKeychain(), existing == token {
                return
            }
            writeKeychain(token)
        }
    }

    /// Clears any stored JWT — call on native logout. Currently
    /// unused (logout is handled inside the WebView via cookie
    /// expiry), but exposed so a future native logout button can
    /// wipe the Keychain without re-implementing the SecItem
    /// dance.
    func clear() {
        queue.sync {
            deleteKeychain()
        }
    }

    // MARK: - Keychain implementation

    private func keychainQuery() -> [String: Any] {
        return [
            kSecClass as String:          kSecClassGenericPassword,
            kSecAttrService as String:    Self.service,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecAttrAccount as String:    Self.account,
        ]
    }

    /// Returns the keychain value if present, `nil` if absent.
    /// Falls back to `UserDefaults` only on hard failures (logged).
    private func readKeychain() -> String? {
        var query = keychainQuery()
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        switch status {
        case errSecSuccess:
            guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
                Self.logger.warning("Keychain returned non-utf8 payload for kalki_token; ignoring")
                return readFallback()
            }
            return value
        case errSecItemNotFound:
            // "Not found" is a clean nil — don't check fallback.
            // If we did, a Keychain that's intentionally empty after
            // a logout would resurface a stale fallback value.
            return nil
        default:
            Self.logger.warning("Keychain read failed (OSStatus \(status, privacy: .public)); consulting fallback")
            return readFallback()
        }
    }

    /// Writes the value. On Keychain failure, falls back to
    /// `UserDefaults` and logs.
    private func writeKeychain(_ token: String) {
        let data = Data(token.utf8)

        // Try to update first. If the item doesn't exist
        // (`errSecItemNotFound`), add it. Doing it in this order
        // avoids the "duplicate item" error on second-write and
        // keeps the call count down to 1 in the steady state.
        let updateQuery = keychainQuery()
        let updateAttrs: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, updateAttrs as CFDictionary)

        switch updateStatus {
        case errSecSuccess:
            clearFallback()
            return
        case errSecItemNotFound:
            // Fresh write — add the item.
            var addQuery = keychainQuery()
            addQuery[kSecValueData as String] = data
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus == errSecSuccess {
                clearFallback()
                return
            }
            Self.logger.warning("Keychain add failed (OSStatus \(addStatus, privacy: .public)); writing to UserDefaults fallback")
            writeFallback(token)
        default:
            Self.logger.warning("Keychain update failed (OSStatus \(updateStatus, privacy: .public)); writing to UserDefaults fallback")
            writeFallback(token)
        }
    }

    private func deleteKeychain() {
        let status = SecItemDelete(keychainQuery() as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            Self.logger.warning("Keychain delete failed (OSStatus \(status, privacy: .public))")
        }
        clearFallback()
    }

    // MARK: - UserDefaults fallback

    private func readFallback() -> String? {
        UserDefaults.standard.string(forKey: Self.fallbackDefaultsKey)
    }

    private func writeFallback(_ token: String) {
        UserDefaults.standard.set(token, forKey: Self.fallbackDefaultsKey)
    }

    private func clearFallback() {
        UserDefaults.standard.removeObject(forKey: Self.fallbackDefaultsKey)
    }
}

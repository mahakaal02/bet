package com.uniquebid.app.data.auth

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * JWT storage backed by [EncryptedSharedPreferences] (PR-ANDROID-SECURITY).
 *
 * Why encrypted, not plain prefs:
 *   - The bearer JWT is the only thing standing between an attacker
 *     and a user's wallet. A rooted device, an adb-backup dump, or
 *     a malicious app on a shared-storage Android could otherwise
 *     read `/data/data/com.uniquebid.app/shared_prefs/uniquebid_auth.xml`
 *     and walk away with a 7-day session.
 *   - `EncryptedSharedPreferences` wraps the file with AES-256-GCM
 *     for values + AES-256-SIV for keys, using a master key sealed
 *     in the Android Keystore (hardware-backed on devices with a
 *     StrongBox / TEE). Without the device unlock, the file is
 *     unreadable even with full filesystem access.
 *
 * Why we still keep [SharedPreferences] (not DataStore): the OkHttp
 * [com.uniquebid.app.data.network.AuthInterceptor] needs the current
 * token synchronously per request. DataStore is async-only.
 *
 * Migration from the previous plaintext file:
 *   - Old file name was `uniquebid_auth` with key `jwt`. New file is
 *     `uniquebid_auth_secure`. On first launch after upgrade we read
 *     any leftover plaintext value, copy it into the encrypted store,
 *     and delete the old file. After that the plaintext file never
 *     exists again.
 *   - We deliberately do NOT throw if the migration read fails — the
 *     worst case is the user re-signs-in once, vs the worst case of
 *     not booting at all.
 *
 * Failure mode if the Keystore is unavailable (e.g. corrupt master
 * key, very old Android image): we fall back to a regular
 * [SharedPreferences] file `uniquebid_auth_fallback` and log a
 * warning. The user still functions; the operator sees the log and
 * knows to investigate. This is rare in practice — Android Keystore
 * is supported on every API 23+ device, and `minSdk = 26` here.
 */
@Singleton
class TokenStore @Inject constructor(@ApplicationContext context: Context) {

    private val prefs: SharedPreferences = buildPrefs(context)

    private val _token = MutableStateFlow(prefs.getString(KEY_TOKEN, null))
    val tokenFlow: StateFlow<String?> = _token.asStateFlow()

    init {
        migrateLegacyPlainPrefsIfNeeded(context)
        // Re-read after migration so an immediately-following
        // currentToken()/tokenFlow read sees the migrated value.
        val migrated = prefs.getString(KEY_TOKEN, null)
        if (migrated != null && _token.value == null) {
            _token.value = migrated
        }
    }

    fun currentToken(): String? = _token.value

    fun setToken(token: String?) {
        _token.value = token
        prefs.edit().apply {
            if (token == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, token)
        }.apply()
    }

    fun clear() = setToken(null)

    // ─── encrypted prefs setup ───────────────────────────────────

    private fun buildPrefs(context: Context): SharedPreferences {
        return try {
            val masterKey = MasterKey.Builder(context)
                // AES256_GCM matches what EncryptedSharedPreferences expects.
                // SetUserAuthenticationRequired(false) is intentional — we
                // don't want to gate every API request on a biometric
                // prompt. The master key is still device-bound via the
                // Keystore; an attacker without the device can't pull it.
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            EncryptedSharedPreferences.create(
                context,
                ENCRYPTED_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (e: Exception) {
            // Keystore failure (corrupt master key, vendor bug, etc.).
            // Fall back to a regular SharedPreferences file rather
            // than crashing — the user can still sign in; we just
            // log loudly so the operator notices.
            Log.w(TAG, "Failed to open EncryptedSharedPreferences, " +
                "falling back to plaintext: ${e.message}")
            context.getSharedPreferences(FALLBACK_FILE, Context.MODE_PRIVATE)
        }
    }

    /**
     * One-shot migration from the legacy plaintext file. Safe to
     * call on every launch — `apply()` on an unchanged editor is a
     * no-op, and the legacy file deletion is idempotent.
     */
    private fun migrateLegacyPlainPrefsIfNeeded(context: Context) {
        try {
            val legacy = context.getSharedPreferences(LEGACY_FILE, Context.MODE_PRIVATE)
            val legacyToken = legacy.getString(KEY_TOKEN, null) ?: return
            // Only copy if the encrypted store is currently empty —
            // never overwrite a fresh sign-in with a stale legacy
            // value (e.g. if migration ran but the user re-logged in
            // before the legacy file got cleared).
            if (prefs.getString(KEY_TOKEN, null) == null) {
                prefs.edit().putString(KEY_TOKEN, legacyToken).apply()
                Log.i(TAG, "Migrated bearer from legacy plaintext store to encrypted store")
            }
            // Clear the legacy file regardless. Once we've at least
            // attempted the copy, the plaintext token has no business
            // living on disk anymore.
            legacy.edit().clear().apply()
            context.deleteSharedPreferences(LEGACY_FILE)
        } catch (e: Exception) {
            // Migration is best-effort. Re-login is an acceptable
            // worst case; crashing the app on startup is not.
            Log.w(TAG, "Legacy prefs migration failed: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "TokenStore"

        // New encrypted store. Distinct name so install-time
        // upgrades don't try to read the old plaintext bytes
        // through the encrypted reader (which would fail).
        private const val ENCRYPTED_FILE = "uniquebid_auth_secure"

        // Legacy plaintext file from before PR-ANDROID-SECURITY.
        // Read once, deleted, never created again.
        private const val LEGACY_FILE = "uniquebid_auth"

        // Last-resort plaintext file used only when the Keystore
        // path fails. Same key/value layout as the encrypted store
        // so the rest of the class doesn't care which it's reading.
        private const val FALLBACK_FILE = "uniquebid_auth_fallback"

        private const val KEY_TOKEN = "jwt"
    }
}

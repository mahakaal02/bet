plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.uniquebid.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.uniquebid.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }

        // Production endpoints. Hostnames match the Helm chart's
        // `kalki-<svc>.cloud.podstack.ai` convention — same names the
        // backend's CORS allowlist baked in (see helm/kalki/values.yaml
        // `backend.corsAllowedOrigins`). The bare `uniquebid.local`
        // values that shipped before were placeholders from the
        // pre-cluster prototype phase and never resolved in DNS.
        //
        // Build variants override these:
        //   • debug   → emulator-host alias (10.0.2.2) for local dev
        //   • release → these values, served over HTTPS
        //
        // The release `network_security_config.xml` blocks cleartext
        // entirely (PR-ANDROID-SECURITY), so HTTPS here isn't optional.
        buildConfigField("String", "API_BASE_URL", "\"https://kalki-backend.cloud.podstack.ai/\"")
        buildConfigField("String", "WS_URL", "\"wss://kalki-backend.cloud.podstack.ai/ws\"")
        buildConfigField("String", "AVIATOR_URL", "\"https://kalki-aviator.cloud.podstack.ai/\"")
        buildConfigField("String", "BET_URL", "\"https://kalki-bet.cloud.podstack.ai/\"")
        // Auctions are their own Next.js app on port 3200 — separate from
        // Bet (3100) and Aviator (3000). Three products, three ports,
        // one shared design system + shared backend.
        //
        // Pointed at `/auctions` (the list page), not `/` (the web hub).
        // The "Live Auctions" tab from the hub lands here directly.
        buildConfigField("String", "AUCTIONS_URL", "\"https://kalki-auctions.cloud.podstack.ai/auctions\"")
        // PR-ANDROID-WEBVIEW-LOGIN-HUB — the native Login + Hub screens
        // were rewritten to host the auctions web app's `/login` and
        // `/` routes inside a WebView (was previously a native Compose
        // login form + native hub card grid that didn't match the web
        // design). Both screens read these URLs.
        buildConfigField("String", "AUCTIONS_LOGIN_URL", "\"https://kalki-auctions.cloud.podstack.ai/login\"")
        buildConfigField("String", "AUCTIONS_HUB_URL", "\"https://kalki-auctions.cloud.podstack.ai/\"")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            // PHYSICAL-DEVICE-SAFE: the previous emulator-only overrides
            // (10.0.2.2 is an emulator-host alias and can't be resolved
            // from a real phone) sent every debug-APK install on a
            // physical device into a 15s connect timeout. We removed
            // those overrides so debug now inherits the production URLs
            // from `defaultConfig` — debug builds remain useful for
            // sideloading + Logcat / R8-disabled debugging without
            // sacrificing reachability.
            //
            // EMULATOR DEVS: when you need to test against a backend
            // running on your host machine instead of prod, override
            // each URL locally (do NOT commit the change):
            //
            //   buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:4000/\"")
            //   buildConfigField("String", "WS_URL",       "\"ws://10.0.2.2:4000/ws\"")
            //   buildConfigField("String", "AVIATOR_URL",  "\"http://10.0.2.2:3000/\"")
            //   buildConfigField("String", "BET_URL",      "\"http://10.0.2.2:3100/\"")
            //   buildConfigField("String", "AUCTIONS_URL", "\"http://10.0.2.2:3200/auctions\"")
            //
            // The debug-only network-security-config carve-out at
            // app/src/debug/res/xml/network_security_config.xml
            // already permits cleartext to 10.0.2.2 / localhost /
            // 127.0.0.1 for this case.
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Sign release builds with the local debug keystore. This is
            // the standard "internal distribution" pattern — the APK is
            // installable on any device without a Play-store upload key,
            // but it's clearly not a Play-Store-publishable artifact
            // (different signature). A proper release-key SigningConfig
            // (KeystoreProperties) lands when we cut the first
            // Play-Store-tracked build.
            //
            // Auto-resolution: signingConfigs.debug uses
            // ~/.android/debug.keystore which Android Studio creates on
            // first launch. If the file is missing, Gradle bootstraps
            // it during the first build — no extra setup required.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    // EncryptedSharedPreferences + Android Keystore master key
    // (PR-ANDROID-SECURITY). Backs TokenStore so the bearer JWT is
    // AES-256-GCM-encrypted at rest with a hardware-bound key, not
    // plaintext under /data/data/.../shared_prefs/.
    implementation(libs.androidx.security.crypto)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.retrofit)
    implementation(libs.retrofit.moshi)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.moshi)
    implementation(libs.moshi.kotlin)
    ksp("com.squareup.moshi:moshi-kotlin-codegen:1.15.1")

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)

    implementation(libs.razorpay.checkout)
    implementation(libs.play.billing)
}

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

        buildConfigField("String", "API_BASE_URL", "\"https://api.uniquebid.local/\"")
        buildConfigField("String", "WS_URL", "\"wss://api.uniquebid.local/ws\"")
        buildConfigField("String", "AVIATOR_URL", "\"https://aviator.uniquebid.local/\"")
        buildConfigField("String", "BET_URL", "\"https://bet.uniquebid.local/\"")
        // Auctions are their own Next.js app on port 3200 — separate from
        // Bet (3100) and Aviator (3000). Three products, three ports,
        // one shared design system + shared backend.
        //
        // Pointed at `/auctions` (the list page), not `/` (the web hub).
        // The Android shell already shows a native hub; landing the
        // WebView on the web hub would surface a redundant "pick a
        // product" view inside the "Live Auctions" tab.
        buildConfigField("String", "AUCTIONS_URL", "\"https://auctions.uniquebid.local/auctions\"")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:4000/\"")
            buildConfigField("String", "WS_URL", "\"ws://10.0.2.2:4000/ws\"")
            buildConfigField("String", "AVIATOR_URL", "\"http://10.0.2.2:3000/\"")
            buildConfigField("String", "BET_URL", "\"http://10.0.2.2:3100/\"")
            buildConfigField("String", "AUCTIONS_URL", "\"http://10.0.2.2:3200/auctions\"")
        }
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
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

package com.uniquebid.app.data.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.PurchasesUpdatedListener
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Google Play Billing scaffolding. NOT wired into the purchase flow yet —
 * Razorpay is the primary payment rail (Slice 4). Play Billing requires:
 *
 *   1. A Google Play Console account with the app published to at least the
 *      internal-test track.
 *   2. In-app product SKUs defined in the Play Console (e.g. `coins_50`,
 *      `coins_120`, `coins_300`) matching the backend's CoinPack ids.
 *   3. A backend service-account key with access to the Google Play Developer
 *      API for server-side purchase verification.
 *   4. A signed release APK installed via the Play Store (debug installs
 *      cannot complete real purchases).
 *
 * To finish the integration: implement `queryProducts`, `launchPurchaseFlow`,
 * and on PurchasesUpdatedListener call a `payments/play/verify` backend
 * endpoint that hits the Google Play Developer API to validate the
 * purchase token, then credit coins (same atomic pattern as Razorpay).
 */
@Singleton
class BillingManager @Inject constructor(
    @ApplicationContext private val context: Context,
) : PurchasesUpdatedListener {

    private val client: BillingClient = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
        )
        .build()

    fun connect(onReady: () -> Unit = {}) {
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Play Billing connected")
                    onReady()
                } else {
                    Log.w(TAG, "Play Billing setup failed: ${result.debugMessage}")
                }
            }
            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Play Billing disconnected")
            }
        })
    }

    override fun onPurchasesUpdated(
        billingResult: BillingResult,
        purchases: MutableList<com.android.billingclient.api.Purchase>?,
    ) {
        // TODO(slice-4+): hand purchase tokens off to backend for server-side
        // validation via the Google Play Developer API. Acknowledge purchases
        // within 3 days or they'll be refunded automatically.
    }

    /** TODO: launchPurchaseFlow(activity, productId) once SKUs are defined in Play Console. */
    @Suppress("UNUSED_PARAMETER")
    fun launchPurchaseFlow(activity: Activity, productId: String) {
        Log.w(TAG, "Play Billing not yet wired — using Razorpay")
    }

    companion object {
        private const val TAG = "BillingManager"
    }
}

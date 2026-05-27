package com.uniquebid.app.data.api.dto

import com.squareup.moshi.JsonClass
import java.math.BigDecimal

@JsonClass(generateAdapter = true)
data class CoinPackDto(
    val id: String,
    val coins: Int,
    val priceInr: BigDecimal,
)

/**
 * Body for POST /wallet/order. Send either `coinPackId` (buy a
 * packaged amount) OR `amount` in rupees (arbitrary top-up, 100-100k).
 * Both omitted or both set → 400 from the server.
 */
@JsonClass(generateAdapter = true)
data class CreateWalletOrderRequest(
    val coinPackId: String? = null,
    val amount: Int? = null,
)

@JsonClass(generateAdapter = true)
data class CreateOrderResponse(
    val orderId: String,
    val razorpayKeyId: String,
    val amountInPaise: Long,
    val currency: String,
    /**
     * Discriminator added by the unified /wallet/order endpoint
     * (backend PR-ARCH-AUDIT, Stage E). "COIN_PACK" — `coinPackId`
     * is set; "WALLET_TOPUP" — `amount` is set; one of them per
     * response.
     */
    val kind: String? = null,
    val coinPackId: String? = null,
    val amount: Int? = null,
)

@JsonClass(generateAdapter = true)
data class VerifyPaymentRequest(
    val orderId: String,
    val paymentId: String,
    val signature: String,
)

@JsonClass(generateAdapter = true)
data class VerifyPaymentResponse(
    val creditedCoins: Int,
    val newBalance: Int,
)

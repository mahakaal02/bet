package com.uniquebid.app.data.api.dto

import com.squareup.moshi.JsonClass
import java.math.BigDecimal

@JsonClass(generateAdapter = true)
data class CoinPackDto(
    val id: String,
    val coins: Int,
    val priceInr: BigDecimal,
)

@JsonClass(generateAdapter = true)
data class CreateOrderResponse(
    val orderId: String,
    val razorpayKeyId: String,
    val amountInPaise: Long,
    val currency: String,
    val coinPackId: String,
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

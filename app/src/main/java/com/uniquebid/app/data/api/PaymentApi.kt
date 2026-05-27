package com.uniquebid.app.data.api

import com.uniquebid.app.data.api.dto.CreateOrderResponse
import com.uniquebid.app.data.api.dto.CreateWalletOrderRequest
import com.uniquebid.app.data.api.dto.VerifyPaymentRequest
import com.uniquebid.app.data.api.dto.VerifyPaymentResponse
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Razorpay endpoints. Unified namespace (backend PR-ARCH-AUDIT,
 * Stage E) — both coin-pack purchases and arbitrary INR wallet
 * top-ups go through /wallet/order + /wallet/verify. The old
 * /payments/* paths are still server-side for in-flight app
 * sessions but emit a Deprecation header.
 */
interface PaymentApi {
    @POST("wallet/order")
    suspend fun createOrder(@Body body: CreateWalletOrderRequest): CreateOrderResponse

    @POST("wallet/verify")
    suspend fun verify(@Body body: VerifyPaymentRequest): VerifyPaymentResponse
}

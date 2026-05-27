package com.uniquebid.app.data.repository

import com.uniquebid.app.data.api.CoinPackApi
import com.uniquebid.app.data.api.PaymentApi
import com.uniquebid.app.data.api.dto.CreateOrderResponse
import com.uniquebid.app.data.api.dto.CreateWalletOrderRequest
import com.uniquebid.app.data.api.dto.VerifyPaymentRequest
import com.uniquebid.app.data.api.dto.VerifyPaymentResponse
import com.uniquebid.app.data.model.CoinPack
import javax.inject.Inject
import javax.inject.Singleton

interface PaymentRepository {
    suspend fun listCoinPacks(): List<CoinPack>
    suspend fun createOrder(coinPackId: String): CreateOrderResponse
    suspend fun verifyPayment(orderId: String, paymentId: String, signature: String): VerifyPaymentResponse
}

@Singleton
class RealPaymentRepository @Inject constructor(
    private val packs: CoinPackApi,
    private val payments: PaymentApi,
) : PaymentRepository {

    override suspend fun listCoinPacks(): List<CoinPack> =
        packs.list().map { CoinPack(it.id, it.coins, it.priceInr) }

    // Unified Razorpay namespace (backend PR-ARCH-AUDIT, Stage E) —
    // /wallet/order discriminates on the body shape so the same call
    // covers both coin packs and arbitrary wallet top-ups.
    override suspend fun createOrder(coinPackId: String): CreateOrderResponse =
        payments.createOrder(CreateWalletOrderRequest(coinPackId = coinPackId))

    override suspend fun verifyPayment(
        orderId: String,
        paymentId: String,
        signature: String,
    ): VerifyPaymentResponse =
        payments.verify(VerifyPaymentRequest(orderId, paymentId, signature))
}

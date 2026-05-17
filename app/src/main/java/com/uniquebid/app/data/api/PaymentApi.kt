package com.uniquebid.app.data.api

import com.uniquebid.app.data.api.dto.CreateOrderResponse
import com.uniquebid.app.data.api.dto.VerifyPaymentRequest
import com.uniquebid.app.data.api.dto.VerifyPaymentResponse
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Path

interface PaymentApi {
    @POST("payments/coin-pack/{id}/order")
    suspend fun createCoinPackOrder(@Path("id") coinPackId: String): CreateOrderResponse

    @POST("payments/verify")
    suspend fun verify(@Body body: VerifyPaymentRequest): VerifyPaymentResponse
}

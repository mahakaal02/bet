package com.uniquebid.app.data.payments

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Razorpay's Checkout SDK delivers results via `PaymentResultListener` on the
 * host Activity. Because Compose ViewModels don't know about the Activity,
 * we bridge the callback through this singleton SharedFlow.
 *
 * MainActivity (which implements PaymentResultListener) emits;
 * WalletViewModel subscribes.
 */
sealed interface RazorpayEvent {
    data class Success(val paymentId: String, val orderId: String, val signature: String) : RazorpayEvent
    data class Failure(val code: Int, val description: String) : RazorpayEvent
}

@Singleton
class RazorpayBus @Inject constructor() {
    private val flow = MutableSharedFlow<RazorpayEvent>(
        replay = 0,
        extraBufferCapacity = 4,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    val events: Flow<RazorpayEvent> = flow.asSharedFlow()

    fun emit(event: RazorpayEvent) {
        flow.tryEmit(event)
    }
}

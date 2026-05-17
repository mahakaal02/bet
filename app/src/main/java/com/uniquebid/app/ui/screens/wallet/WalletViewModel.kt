package com.uniquebid.app.ui.screens.wallet

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.razorpay.Checkout
import com.uniquebid.app.data.api.dto.CreateOrderResponse
import com.uniquebid.app.data.model.CoinPack
import com.uniquebid.app.data.model.User
import com.uniquebid.app.data.payments.RazorpayBus
import com.uniquebid.app.data.payments.RazorpayEvent
import com.uniquebid.app.data.repository.AuthRepository
import com.uniquebid.app.data.repository.PaymentRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import org.json.JSONObject
import javax.inject.Inject

data class WalletUiState(
    val loading: Boolean = true,
    val user: User? = null,
    val packs: List<CoinPack> = emptyList(),
    val purchasingPackId: String? = null,
    val statusMessage: String? = null,
    val error: String? = null,
)

@HiltViewModel
class WalletViewModel @Inject constructor(
    private val payments: PaymentRepository,
    private val auth: AuthRepository,
    private val razorpayBus: RazorpayBus,
) : ViewModel() {

    private val _state = MutableStateFlow(WalletUiState())
    val state: StateFlow<WalletUiState> = _state.asStateFlow()

    private var pendingOrderId: String? = null

    init {
        load()
        razorpayBus.events
            .onEach(::onRazorpayEvent)
            .launchIn(viewModelScope)
    }

    fun load() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                val user = auth.me()
                val packs = payments.listCoinPacks()
                _state.value = _state.value.copy(loading = false, user = user, packs = packs)
            } catch (e: Throwable) {
                _state.value = _state.value.copy(loading = false, error = e.message ?: "failed to load")
            }
        }
    }

    /**
     * Kick off the purchase. Backend creates the Razorpay order, we open
     * Checkout. The Activity-implemented PaymentResultListener will route
     * the result back through RazorpayBus.
     */
    fun buy(packId: String, activity: Activity) {
        viewModelScope.launch {
            _state.value = _state.value.copy(purchasingPackId = packId, error = null, statusMessage = null)
            val order = try {
                payments.createOrder(packId)
            } catch (e: Throwable) {
                _state.value = _state.value.copy(
                    purchasingPackId = null,
                    error = e.message ?: "could not create order",
                )
                return@launch
            }
            pendingOrderId = order.orderId
            openCheckout(activity, order)
        }
    }

    private fun openCheckout(activity: Activity, order: CreateOrderResponse) {
        val user = _state.value.user
        val options = JSONObject().apply {
            put("key", order.razorpayKeyId)
            put("name", "Kalki Bet")
            put("description", "Coin pack purchase")
            put("order_id", order.orderId)
            put("amount", order.amountInPaise)
            put("currency", order.currency)
            put("theme", JSONObject().put("color", "#3A1C71"))
            if (user != null) {
                put("prefill", JSONObject()
                    .put("email", user.email)
                    .put("contact", ""))
            }
        }
        try {
            Checkout().open(activity, options)
        } catch (e: Throwable) {
            _state.value = _state.value.copy(
                purchasingPackId = null,
                error = "could not open Razorpay: ${e.message}",
            )
        }
    }

    private fun onRazorpayEvent(event: RazorpayEvent) {
        when (event) {
            is RazorpayEvent.Success -> verifyPayment(event.orderId, event.paymentId, event.signature)
            is RazorpayEvent.Failure -> {
                _state.value = _state.value.copy(
                    purchasingPackId = null,
                    error = if (event.code == 0) "Payment cancelled." else event.description,
                )
                pendingOrderId = null
            }
        }
    }

    private fun verifyPayment(orderId: String, paymentId: String, signature: String) {
        if (orderId != pendingOrderId) {
            // Defensive: stray event from a previous purchase.
            return
        }
        viewModelScope.launch {
            try {
                val result = payments.verifyPayment(orderId, paymentId, signature)
                val refreshed = auth.me()
                _state.value = _state.value.copy(
                    purchasingPackId = null,
                    user = refreshed,
                    statusMessage = "Added ${result.creditedCoins} coins. Balance: ${result.newBalance} 🪙",
                    error = null,
                )
            } catch (e: Throwable) {
                _state.value = _state.value.copy(
                    purchasingPackId = null,
                    error = "Payment captured but verification failed: ${e.message}",
                )
            } finally {
                pendingOrderId = null
            }
        }
    }
}

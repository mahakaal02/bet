package com.uniquebid.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.razorpay.Checkout
import com.razorpay.PaymentData
import com.razorpay.PaymentResultWithDataListener
import com.uniquebid.app.data.payments.RazorpayBus
import com.uniquebid.app.data.payments.RazorpayEvent
import com.uniquebid.app.ui.navigation.UniqueBidNavGraph
import com.uniquebid.app.ui.theme.UniqueBidTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity(), PaymentResultWithDataListener {

    @Inject lateinit var razorpayBus: RazorpayBus

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        Checkout.preload(applicationContext)
        setContent { UniqueBidAppContent() }
    }

    override fun onPaymentSuccess(paymentId: String?, paymentData: PaymentData?) {
        val pid = paymentId ?: return
        val data = paymentData?.data
        val orderId = data?.optString("razorpay_order_id").orEmpty()
        val signature = data?.optString("razorpay_signature").orEmpty()
        if (orderId.isEmpty() || signature.isEmpty()) {
            razorpayBus.emit(RazorpayEvent.Failure(-1, "missing order id or signature"))
            return
        }
        razorpayBus.emit(RazorpayEvent.Success(pid, orderId, signature))
    }

    override fun onPaymentError(code: Int, description: String?, paymentData: PaymentData?) {
        razorpayBus.emit(RazorpayEvent.Failure(code, description ?: "payment failed"))
    }
}

@Composable
private fun UniqueBidAppContent() {
    UniqueBidTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            UniqueBidNavGraph()
        }
    }
}

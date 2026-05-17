package com.uniquebid.app.data.coins

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * App-wide cache of the signed-in user's coin balance. Top-bar coin chips and
 * any other widget that needs the balance subscribe here so they all stay in
 * lockstep without each one round-tripping to `/auth/me`.
 *
 * Writers: [AuthRepository] after login / register / me, [WalletViewModel]
 * after a Razorpay purchase verifies, [BidViewModel] after a bid is placed.
 */
@Singleton
class CoinBalanceStore @Inject constructor() {
    private val _balance = MutableStateFlow<Int?>(null)
    val balance: StateFlow<Int?> = _balance.asStateFlow()

    fun set(value: Int) {
        _balance.value = value
    }

    fun clear() {
        _balance.value = null
    }
}

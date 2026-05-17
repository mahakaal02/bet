package com.uniquebid.app.data.model

import java.math.BigDecimal

data class CoinPack(
    val id: String,
    val coins: Int,
    val priceInr: BigDecimal,
)

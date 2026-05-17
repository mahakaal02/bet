package com.uniquebid.app.data.network

import com.squareup.moshi.FromJson
import com.squareup.moshi.ToJson
import java.math.BigDecimal
import java.time.Instant

class BigDecimalAdapter {
    @FromJson fun fromJson(value: String): BigDecimal = BigDecimal(value)
    @ToJson fun toJson(value: BigDecimal): String = value.toPlainString()
}

class InstantAdapter {
    @FromJson fun fromJson(value: String): Instant = Instant.parse(value)
    @ToJson fun toJson(value: Instant): String = value.toString()
}

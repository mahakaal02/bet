package com.uniquebid.app.data.api

import com.uniquebid.app.data.api.dto.CoinPackDto
import retrofit2.http.GET

interface CoinPackApi {
    @GET("coin-packs")
    suspend fun list(): List<CoinPackDto>
}

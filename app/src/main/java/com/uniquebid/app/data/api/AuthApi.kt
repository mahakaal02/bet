package com.uniquebid.app.data.api

import com.uniquebid.app.data.api.dto.AuthResponseDto
import com.uniquebid.app.data.api.dto.LoginRequest
import com.uniquebid.app.data.api.dto.RegisterRequest
import com.uniquebid.app.data.api.dto.UserDto
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface AuthApi {
    @POST("auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponseDto

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponseDto

    @GET("auth/me")
    suspend fun me(): UserDto
}

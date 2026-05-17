package com.uniquebid.app.data.api.dto

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class RegisterRequest(
    val email: String,
    val username: String,
    val password: String,
)

@JsonClass(generateAdapter = true)
data class LoginRequest(
    val email: String,
    val password: String,
)

@JsonClass(generateAdapter = true)
data class UserDto(
    val id: String,
    val email: String,
    val username: String,
    val emailVerified: Boolean,
    val coinBalance: Int,
    val isAdmin: Boolean,
)

@JsonClass(generateAdapter = true)
data class AuthResponseDto(
    val token: String,
    val user: UserDto,
)

package com.uniquebid.app.data.model

data class User(
    val id: String,
    val username: String,
    val email: String,
    val coinBalance: Int,
    val emailVerified: Boolean,
)

package com.uniquebid.app.data.repository

import com.uniquebid.app.data.api.AuthApi
import com.uniquebid.app.data.api.dto.LoginRequest
import com.uniquebid.app.data.api.dto.RegisterRequest
import com.uniquebid.app.data.auth.TokenStore
import com.uniquebid.app.data.coins.CoinBalanceStore
import com.uniquebid.app.data.model.User
import javax.inject.Inject
import javax.inject.Singleton

interface AuthRepository {
    suspend fun login(email: String, password: String): User
    suspend fun register(email: String, username: String, password: String): User
    suspend fun me(): User
    fun logout()
    fun isAuthenticated(): Boolean
}

@Singleton
class RealAuthRepository @Inject constructor(
    private val api: AuthApi,
    private val tokens: TokenStore,
    private val coinBalance: CoinBalanceStore,
) : AuthRepository {

    override suspend fun login(email: String, password: String): User {
        val response = api.login(LoginRequest(email, password))
        tokens.setToken(response.token)
        val user = response.user.toDomain()
        coinBalance.set(user.coinBalance)
        return user
    }

    override suspend fun register(email: String, username: String, password: String): User {
        val response = api.register(RegisterRequest(email, username, password))
        tokens.setToken(response.token)
        val user = response.user.toDomain()
        coinBalance.set(user.coinBalance)
        return user
    }

    override suspend fun me(): User {
        val user = api.me().toDomain()
        coinBalance.set(user.coinBalance)
        return user
    }

    override fun logout() {
        tokens.clear()
        coinBalance.clear()
    }

    override fun isAuthenticated(): Boolean = tokens.currentToken() != null
}

private fun com.uniquebid.app.data.api.dto.UserDto.toDomain() = User(
    id = id,
    username = username,
    email = email,
    coinBalance = coinBalance,
    emailVerified = emailVerified,
)

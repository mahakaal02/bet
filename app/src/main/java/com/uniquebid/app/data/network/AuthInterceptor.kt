package com.uniquebid.app.data.network

import com.uniquebid.app.data.auth.TokenStore
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokens: TokenStore,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request()
        val token = tokens.currentToken()
        val authed = if (token != null) {
            req.newBuilder().header("Authorization", "Bearer $token").build()
        } else {
            req
        }
        val response = chain.proceed(authed)
        if (response.code == 401 && token != null) {
            tokens.clear()
        }
        return response
    }
}
